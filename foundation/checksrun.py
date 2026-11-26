"""CHECKS-SESSION-1: run the `checks` workflow's steps in a cloud session, the second route when hosted Actions cannot start
(observed 2026-11-15: every job refused with "recent account payments have failed or your spending limit needs to be increased").

  python3 -m foundation checksrun [--json]    runs every `run:` step of .github/workflows/checks.yml in order, honouring working-directory
                                              and the job env; exit 1 on any failed step. Evidence: one JSON line per run in ops/checks-session.jsonl
  python3 -m foundation checksrun --list      the steps, and which a session cannot run, without running anything
  python3 -m foundation checksrun --help      this text; nothing runs
Steps whose script uses a GitHub expression the session cannot evaluate (`${{ ... }}`) are evaluated with the PR defaults (base_ref main).
CHECKSRUN-SCOPE-1: a step that reads other jobs' results (`needs.*`), or needs the Actions-only GITHUB_REPOSITORY (the job-result
gate and the merge step), cannot run outside Actions. It is recorded as skipped with its reason and never as failed or passed: two such steps
read as failures on every session run and hid the real one. An unknown argument is refused, so `--help` can no longer start a half-hour run.
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


def unrunnable(script: str, env: dict) -> str:
    """Why a session cannot run this step, or '' when it can."""
    if re.search(r"\$\{\{\s*needs\.", script):
        return "reads the results of other Actions jobs"
    if re.search(r"\bGITHUB_REPOSITORY\b", script) and "GITHUB_REPOSITORY" not in {**os.environ, **env}:
        return "needs GITHUB_REPOSITORY, which only Actions sets"
    for m in re.finditer(r"(?:^|\s)(?:bash\s+)?((?:\./)?scripts/[\w.-]+\.sh)", script):  # one level into the script a step calls
        f = REPO / m.group(1).lstrip("./")
        if f.exists() and re.search(r"\$\{?GITHUB_REPOSITORY[:?}]", f.read_text(encoding="utf-8")) and "GITHUB_REPOSITORY" not in {**os.environ, **env}:
            return f"{m.group(1)} needs GITHUB_REPOSITORY, which only Actions sets"
    return ""


def run(root=REPO, runner=None) -> dict:
    runner = runner or (lambda sc, cwd, env: subprocess.run(["bash", "-ec", sc], cwd=Path(root) / cwd, env={**os.environ, **env}, capture_output=True, text=True, timeout=600))
    res = []
    for s in steps(root):
        env = {k: str(v) for k, v in s["env"].items() if "${{" not in str(v)}
        why = unrunnable(resolve(s["run"]), env)
        if why:
            res.append({"step": s["name"], "ok": None, "skipped": why, "tail": ""})
            continue
        try:
            p = runner(resolve(s["run"]), s["cwd"], env)
        except subprocess.TimeoutExpired as e:  # CHECKSRUN-TIMEOUT-1: one slow step is a failed step with its tail, never a crash that records no evidence row
            out = (e.stdout or b"") + (e.stderr or b"")
            out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
            res.append({"step": s["name"], "ok": False, "tail": (out[-1200:] + f"\ntimed out after {e.timeout:.0f} s")[-1500:]})
            continue
        res.append({"step": s["name"], "ok": p.returncode == 0, "tail": "" if p.returncode == 0 else (p.stdout + p.stderr)[-1500:]})
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    return {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "sha": head, "steps": len(res), "failed": [r["step"] for r in res if r["ok"] is False], "skipped": [r["step"] for r in res if r["ok"] is None], "results": res}


def main(argv) -> int:
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0
    if "--list" in argv:
        for s in steps():
            why = unrunnable(resolve(s["run"]), {k: str(v) for k, v in s["env"].items() if "${{" not in str(v)})
            print(("skip " + s["name"] + ": " + why) if why else ("run  " + s["name"]))
        return 0
    bad = [a for a in argv if a != "--json"]
    if bad:
        print(f"checksrun: unknown argument {bad[0]} (see --help); nothing was run")
        return 2
    r = run()
    with open(REPO / LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({k: r[k] for k in ("at", "sha", "steps", "failed", "skipped")}) + "\n")
    if "--json" in argv:
        print(json.dumps(r, indent=1))
    else:
        for x in r["results"]:
            if x["ok"] is False:
                print(f"FAIL {x['step']}\n{x['tail']}")
            elif x["ok"] is None:
                print(f"SKIP {x['step']}: {x['skipped']}")
        print(f"checksrun: {r['steps']} steps, {len(r['failed'])} failed, {len(r['skipped'])} skipped (Actions only), sha {r['sha'][:7]}")
    return 1 if r["failed"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
