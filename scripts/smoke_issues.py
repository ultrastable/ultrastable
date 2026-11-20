#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SMOKE-LIVE-1: turn smoke_live.py results into repair items in this repository's own format (docs/issues/Q-SMOKE-*.json; GitHub Issues are disabled here).
# A failing check writes or refreshes its item; a passing check marks its item done. Landing: the main-writer route first (tools/push_main.py), then a branch + pull request.
import json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rows = json.load(open(sys.argv[1]))
changed = []
for r in rows:
    i = "Q-SMOKE-" + re.sub(r"[^A-Za-z0-9]+", "-", r["id"]).strip("-")
    p = ROOT / "docs/issues" / f"{i}.json"
    if r["result"] == "FAIL":
        body = (f"**Owner:** executor\n**Trigger:** smoke-live (every 6 hours)\n**Done check:** `python3 scripts/smoke_live.py` shows PASS for `{r['id']}`\n**Status:** open\n\n"
                f"SMOKE-LIVE-1: {r['claim']}\n\nLive evidence: `{r['evidence']}`\n\nFix the code or the words so production does what is claimed, deploy, and smoke-live closes this.\n\n"
                f"size: S\n\n**Closing probe:** workflow smoke-live, check `{r['id']}` = PASS.\n")
        item = {"id": i, "title": f"{i}: production does not match the claim ({r['id']})", "body": body, "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Claims"}
        new = json.dumps(item, indent=2) + "\n"
        if not p.exists() or p.read_text(encoding="utf-8") != new:
            p.parent.mkdir(parents=True, exist_ok=True); p.write_text(new, encoding="utf-8"); changed.append(str(p.relative_to(ROOT)))
    elif r["result"] == "PASS" and p.exists():
        p.unlink(); changed.append(str(p.relative_to(ROOT)))
if not changed:
    print("smoke_issues: no item changed"); sys.exit(0)
print("smoke_issues: items changed:", changed)
def sh(*a, check=True): return subprocess.run(a, cwd=ROOT, check=check, capture_output=True, text=True)
sh("git", "config", "user.name", "ultrastable-smoke"); sh("git", "config", "user.email", "actions@users.noreply.github.com")
sh("git", "add", "-A", "docs/issues"); sh("git", "commit", "-q", "-m", "smoke-live: repair items from the production smoke test [skip ci]")
if subprocess.run(["python3", "tools/push_main.py"], cwd=ROOT).returncode == 0: sys.exit(0)
br = "agent/smoke-live-" + os.environ.get("GITHUB_RUN_ID", "local")
sh("git", "push", "-q", "origin", f"HEAD:refs/heads/{br}", check=False)
pr = sh("gh", "pr", "create", "--base", "main", "--head", br, "--title", "smoke-live: repair items from the production smoke test", "--body", "SMOKE-LIVE-1: items written by scripts/smoke_issues.py.\n\nItem: SMOKE-LIVE-1", check=False)
print("pull request:", (pr.stdout or pr.stderr).strip()[:200]); sys.exit(0 if pr.returncode == 0 else 1)
