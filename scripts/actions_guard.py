#!/usr/bin/env python3
"""Kill switch for non-essential workflows. Usage: actions_guard.py <workflow-name>.
Reads actions-budget.json; when paused (globally or for this workflow) and the workflow is not essential,
cancels the current run so it costs almost nothing. Needs GH_TOKEN and `actions: write`.
Public repositories run Actions free (no minute quota to protect), so the pause does not apply to them: a pause that
only turns scheduled runs into red failures (cancel needs `actions: write`, which most workflows lack) protects nothing."""
import json, os, subprocess, sys, time

def is_public(repo):
    r = subprocess.run(["gh", "api", f"repos/{repo}", "--jq", ".private"], capture_output=True, text=True)
    return r.returncode == 0 and r.stdout.strip() == "false"

def main(name):
    cfg = json.load(open("actions-budget.json"))
    if name in cfg.get("essential", []):
        return 0
    if not (cfg.get("paused") or name in cfg.get("paused_workflows", [])):
        return 0
    repo, run = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_RUN_ID"]
<<<<<<< HEAD
    if is_public(repo):
        print(f"::notice::actions-budget.json pauses '{name}' but {repo} is public (Actions are free); running")
        return 0
=======
    v = subprocess.run(["gh", "api", f"repos/{repo}", "--jq", ".private"], capture_output=True, text=True)
    if v.returncode == 0 and v.stdout.strip() == "false":
        print(f"::notice::{repo} is public: Actions minutes are free, so the budget pause does not apply to '{name}'")
        return 0  # the budget exists for private-repo minutes; a public repo never pauses (a red X here was the whole failure)
>>>>>>> origin/main
    print(f"::notice::actions-budget.json pauses '{name}'; cancelling this run")
    r = subprocess.run(["gh", "api", "-X", "POST", f"repos/{repo}/actions/runs/{run}/cancel"], capture_output=True, text=True)
    if r.returncode:
        print(f"::warning::cancel failed ({r.stderr.strip()}); stopping with failure so no work runs")
        return 1
    time.sleep(60)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
