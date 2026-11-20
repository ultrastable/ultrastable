#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SMOKE-LIVE-1: turn smoke_live.py results into repair items. One issue per failing check ("SMOKE: <id>", label agent-ready), idempotent; a check that passes closes its issue.
import json, subprocess, sys

def gh(*a):
    r = subprocess.run(["gh", *a], capture_output=True, text=True)
    if r.returncode: print("gh", a[:3], "failed:", r.stderr[:200]); return None
    return r.stdout

rows = json.load(open(sys.argv[1]))
open_issues = json.loads(gh("issue", "list", "--state", "open", "--search", "SMOKE: in:title", "--json", "number,title", "--limit", "100") or "[]")
by_title = {i["title"]: i["number"] for i in open_issues}
for r in rows:
    title = "SMOKE: " + r["id"]
    n = by_title.get(title)
    if r["result"] == "FAIL":
        body = (f"**Owner:** executor\n**Trigger:** smoke-live (every 6 hours)\n**Done check:** `python3 scripts/smoke_live.py` shows PASS for `{r['id']}`\n\n"
                f"Claim: {r['claim']}\n\nLive evidence: `{r['evidence']}`\n\nFix the code or the words so production does what is claimed, deploy, and let smoke-live close this.\n\n**Closing probe:** workflow smoke-live, check `{r['id']}` = PASS.")
        if n: gh("issue", "comment", str(n), "--body", "Still failing: " + r["evidence"])
        else: gh("issue", "create", "--title", title, "--body", body, "--label", "agent-ready")
    elif r["result"] == "PASS" and n:
        gh("issue", "close", str(n), "--comment", "Passing in production now: " + r["evidence"])
