#!/usr/bin/env python3
"""LOCAL-CHECKS-1: run the `checks` workflow's steps without GitHub Actions.

Why: when Actions minutes are unavailable (billing failure, budget cap) every
pull request shows a red `checks` that never ran, and the merge queue stalls.
This runner reads .github/workflows/checks.yml and executes each `run:` step
in order with bash, honouring `working-directory` and step `env`, skipping
`uses:` steps. Exit code 0 means every step passed, the same bar CI applies.

  python3 scripts/local_checks.py            # run all steps, stop at first failure
  python3 scripts/local_checks.py --keep-going
  python3 scripts/local_checks.py --json     # machine-readable verdict
"""
import argparse, json, os, re, shutil, subprocess, sys, time

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPR = re.compile(r"\$\{\{[^}]*\}\}")


def steps(workflow):
    with open(workflow, encoding="utf-8") as f:
        wf = yaml.safe_load(f)
    for job_name, job in (wf.get("jobs") or {}).items():
        for i, st in enumerate(job.get("steps") or []):
            if "run" not in st:
                continue
            yield {
                "job": job_name,
                "name": st.get("name") or st["run"].strip().splitlines()[0][:70],
                "run": EXPR.sub("", st["run"]),
                "cwd": os.path.join(ROOT, st.get("working-directory", ".")),
                "env": {k: EXPR.sub("", str(v)) for k, v in (st.get("env") or {}).items()},
                "continue": bool(st.get("continue-on-error")),
            }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workflow", default=os.path.join(ROOT, ".github", "workflows", "checks.yml"))
    ap.add_argument("--keep-going", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    bash = shutil.which("bash") or "bash"
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1", CI="true",
               GITHUB_BASE_REF=os.environ.get("GITHUB_BASE_REF", "main"))
    results, ok = [], True
    for st in steps(a.workflow):
        t = time.time()
        p = subprocess.run([bash, "-e", "-o", "pipefail", "-c", st["run"]], cwd=st["cwd"],
                           env={**env, **st["env"]}, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        r = {"name": st["name"], "rc": p.returncode, "secs": round(time.time() - t, 1)}
        if p.returncode:
            r["tail"] = (p.stdout + p.stderr)[-1500:]
        results.append(r)
        if not a.json:
            print(("PASS" if not p.returncode else "FAIL"), f"{r['secs']:>5}s", st["name"], flush=True)
            if p.returncode:
                print(r["tail"])
        if p.returncode and not st["continue"]:
            ok = False
            if not a.keep_going:
                break
    if a.json:
        print(json.dumps({"ok": ok, "steps": results}, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
