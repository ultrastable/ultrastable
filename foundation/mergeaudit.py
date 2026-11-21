# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MERGE-AUDIT-1: a detective control for every merge path the code cannot gate.
PR #619 merged two seconds after its `checks` run started, by a session's own token through the API; greenguard (the tick lane and sweeper) and
lane.sh never saw it, and main then failed claimcode. Branch protection cannot close that path without blocking the lane's own direct pushes of
generated files, so this audits after the fact: every PR merged in the last window whose head commit has no successful `checks` run becomes a
queue item (Q-CIFAIL-mergeaudit-<n>, effect tier, taken before growth work) with a closing probe: a later merged PR passed `checks`.
  python3 -m foundation mergeaudit [--run [--apply]] | --probe N | --check"""
from __future__ import annotations
import datetime as dt, json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SLUG, WINDOW_H = "ultrastable/ultrastable", 6


def gh(*args) -> tuple[int, str]:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", timeout=120)
    return r.returncode, (r.stdout if r.returncode == 0 else r.stdout + r.stderr)


def merged(run=gh, now=None, window_h=WINDOW_H) -> list[dict]:
    code, o = run("api", f"repos/{SLUG}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=30&check_suite_filter=all")
    if code:
        raise RuntimeError("pulls unreadable: " + o[:120])
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    for p in json.loads(o or "[]"):
        if p.get("merged_at") and (now - dt.datetime.fromisoformat(p["merged_at"].replace("Z", "+00:00"))).total_seconds() <= window_h * 3600:
            out.append({"n": p["number"], "sha": p["head"]["sha"], "title": p["title"], "merged_at": p["merged_at"]})
    return sorted(out, key=lambda x: x["merged_at"])


def gate(sha: str, run=gh) -> str:
    """'success' when the full-suite `checks` run passed on this exact head commit, else its conclusion or 'missing'. Unreadable raises: unknown is not green."""
    code, o = run("api", f"repos/{SLUG}/commits/{sha}/check-runs?per_page=100", "--jq", '[.check_runs[]|select(.name=="checks")|(.conclusion // .status)]')
    if code:
        raise RuntimeError("check-runs unreadable: " + o[:120])
    c = json.loads(o or "[]")
    return "success" if "success" in c else (c[0] if c else "missing")


def item(p: dict, state: str) -> dict:
    n = p["n"]
    body = (f"**Owner:** staff\n**Trigger:** every lane pass\n**Done check:** cmd:python3 -m foundation mergeaudit --probe {n}\n**Status:** open\n\n"
            f"MERGE-AUDIT-1: PR #{n} ({p['title']}) merged at {p['merged_at']} with its `checks` run at `{state}` on head {p['sha'][:7]}. Some merge path skipped the green gate.\n\n"
            f"Fix what that run caught on main (run the failed step from .github/workflows/checks.yml locally), then confirm a later merged PR passed `checks`. Do not weaken a check.")
    return {"id": f"Q-CIFAIL-mergeaudit-{n}", "title": f"Q-CIFAIL-mergeaudit-{n}: PR #{n} merged without a green checks run", "body": body, "labels": ["role:staff", "ci-failure"], "milestone": "Now", "workstream": "Reliability"}


def scan(root=REPO, apply=False, run=gh, now=None) -> list[dict]:
    root, rows = Path(root), []
    for p in merged(run, now):
        state = gate(p["sha"], run)
        if state in ["success", "skipped"]:
            continue
        f = root / "docs/issues" / f"Q-CIFAIL-mergeaudit-{p['n']}.json"
        new = not f.exists()
        if apply and new:
            f.write_text(json.dumps(item(p, state), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        rows.append({"pr": p["n"], "checks": state, "filed": bool(apply and new), "known": not new})
    return rows


def probe(n: int, run=gh, now=None) -> bool:
    later = [p for p in merged(run, now, window_h=24 * 14) if p["n"] > n]
    return any(gate(p["sha"], run) == "success" for p in later)


def main(argv) -> int:
    if argv[:1] == ["--check"]:
        ok = (REPO / ".github/workflows/lane.yml").is_file() and "mergeaudit" in (REPO / "scripts/lane.sh").read_text(encoding="utf-8")
        print("mergeaudit ok" if ok else "mergeaudit: scripts/lane.sh does not run it"); return 0 if ok else 1
    if argv[:1] == ["--probe"]:
        ok = probe(int(argv[1])); print("green since" if ok else "no later green merge yet"); return 0 if ok else 1
    rows = scan(apply="--apply" in argv)
    print(json.dumps(rows, indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
