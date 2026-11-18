#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# SPINOFF-DEPLOY-1: every app in the generated bundle must answer 200 at <slug>.<domain> (410 only for retired ones).
# Ultrastable is the foundation for any autonomous system.
import json, sys, urllib.request, urllib.error
r = json.load(open("spinoffs/registry.json"))
bad = []
for slug in r["apps"]:
    want = 410 if slug in r.get("retired", []) else 200
    url = f"https://{slug}.{r['domain']}/"
    try:
        code = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-probe"}), timeout=20).status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        code = repr(e)
    print(slug, code)
    if code != want:
        bad.append(f"{slug}: {code}")
if bad:
    print("::error::spinoff apps not serving: " + "; ".join(bad)); sys.exit(1)
