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
sys.path.insert(0, str(ROOT / "scripts"))
import land_data
sys.exit(land_data.main("smoke-live: repair items from the production smoke test", ["docs/issues"]))
