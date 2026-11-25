"""CHECKS-SESSION-1: run the `checks` workflow's steps in a cloud session, the second route when hosted Actions cannot start
(observed 2026-11-15: every job refused with "recent account payments have failed or your spending limit needs to be increased").

  python3 -m foundation checksrun [--json]    runs every `run:` step of .github/workflows/checks.yml in order, honouring working-directory
                                              and the job env; exit 1 on any failed step. Evidence: one JSON line per run in ops/checks-session.jsonl
Steps whose script uses a GitHub expression the session cannot evaluate (`${{ ... }}`) are evaluated with the PR defaults (base_ref main).
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WF, LOG = ".github/workflows/checks.yml", "ops/checks-session.jsonl"
EXPR = {r"\$\{\{\s*github\.base_ref\s*\|\|\s*'main'\s*\}\}": "main", r"\$\{\{\s*github\.base_ref\s*\}\}": "main"}


def steps(root=REPO) -> list[dict]:
    import yaml
    w = yaml.safe_load((Path(root) / WF).read_text(encoding="utf-8"))
    out = []
    for j in w["jobs"].values():
        for s in j.get("steps", []):
            if "run" in s:
                out.append({"name": s.get("name", s["run"][:40]), "run": s["run"], "cwd": s.get("working-directory", "."), "env": {**j.get("env", {}), **s.get("env", {})}})
    return out


def resolve(script: str) -> str:
    for pat, val in EXPR.items():
        script = re.sub(pat, val, script)
    return script


def run(root=REPO, runner=None) -> dict:
    runner = runner or (lambda sc, cwd, env: subprocess.run(["bash", "-ec", sc], cwd=Path(root) / cwd, env={**os.environ, **env}, capture_output=True, text=True, timeout=600))
    res = []
    for s in steps(root):
        env = {k: str(v) for k, v in s["env"].items() if "${{" not in str(v)}
        try:
            p = runner(resolve(s["run"]), s["cwd"], env)
        except subprocess.TimeoutExpired as e:  # CHECKSRUN-TIMEOUT-1: one slow step is a failed step with its tail, never a crash that records no evidence row
            out = (e.stdout or b"") + (e.stderr or b"")
            out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
            res.append({"step": s["name"], "ok": False, "tail": (out[-1200:] + f"\ntimed out after {e.timeout:.0f} s")[-1500:]})
            continue
        res.append({"step": s["name"], "ok": p.returncode == 0, "tail": "" if p.returncode == 0 else (p.stdout + p.stderr)[-1500:]})
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    return {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sha": head, "steps": len(res), "failed": [r["step"] for r in res if not r["ok"]], "results": res}


def main(argv) -> int:
    r = run()
    with open(REPO / LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({k: r[k] for k in ("at", "sha", "steps", "failed")}) + "\n")
    if "--json" in argv:
        print(json.dumps(r, indent=1))
    else:
        for x in r["results"]:
            if not x["ok"]:
                print(f"FAIL {x['step']}\n{x['tail']}")
        print(f"checksrun: {r['steps']} steps, {len(r['failed'])} failed, sha {r['sha'][:7]}")
    return 1 if r["failed"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
