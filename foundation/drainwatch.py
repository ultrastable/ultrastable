"""DRAIN-FLEET-1: open issues and open PRs, per repository, across the whole fleet. The target is 0 and 0.

  python3 -m foundation drainwatch            counts per repo in github/org-settings.json; exit 1 while any count is above 0
  python3 -m foundation drainwatch --json     the same as JSON (consumed by the lane and the criticality tick)
A repository that cannot be read is reported as unmeasured, never as 0. Pure logic: summarize().
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def repos(root=REPO) -> list[str]:
    return sorted(json.loads((Path(root) / "github/org-settings.json").read_text(encoding="utf-8"))["repos"])


def gh_list(path: str):
    p = subprocess.run(["gh", "api", "--paginate", path], capture_output=True, text=True, timeout=120)
    if p.returncode:
        return None
    out = []
    for chunk in p.stdout.replace("][", "]\n[").splitlines():
        if chunk.strip():
            out += json.loads(chunk)
    return out


def summarize(raw: dict) -> dict:
    """raw: {repo: {"issues": list|None, "pulls": list|None}} -> per-repo counts and fleet totals."""
    rows, tot, unmeasured = {}, {"open_issues": 0, "open_prs": 0}, []
    for r, d in raw.items():
        if d["issues"] is None or d["pulls"] is None:
            unmeasured.append(r); continue
        issues = [i for i in d["issues"] if "pull_request" not in i]
        rows[r] = {"open_issues": len(issues), "open_prs": len(d["pulls"])}
        for k in tot:
            tot[k] += rows[r][k]
    return {"repos": rows, "fleet": tot, "unmeasured": unmeasured, "drained": tot == {"open_issues": 0, "open_prs": 0} and not unmeasured}


def measure(root=REPO, fetch=gh_list) -> dict:
    return summarize({r: {"issues": fetch(f"repos/{r}/issues?state=open&per_page=100"), "pulls": fetch(f"repos/{r}/pulls?state=open&per_page=100")} for r in repos(root)})


def main(argv) -> int:
    s = measure()
    if "--json" in argv:
        print(json.dumps(s, indent=1))
    else:
        for r, c in s["repos"].items():
            print(f"{r}: open_issues={c['open_issues']} open_prs={c['open_prs']}")
        for r in s["unmeasured"]:
            print(f"{r}: unmeasured (read failed)")
        print(f"fleet: open_issues={s['fleet']['open_issues']} open_prs={s['fleet']['open_prs']} drained={s['drained']}")
    return 0 if s["drained"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
