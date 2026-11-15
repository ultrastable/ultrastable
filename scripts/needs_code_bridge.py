#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""NEEDS-CODE-BRIDGE-1: the second route that builds parked work, so no deployment waits on a person's prompt.

The in-tick doer can only edit the backlog database, so it parks every item that needs a code change as `needs-code:`. The Worker-native
executor takes those through the GitHub credential its tick holds; a new deployment holds none until its GitHub App is installed, and the
backlog then fills with work nothing builds (66 items, 2026-11-15). This script reads the deployment's public API (GET /api/v1/work?view=blocked),
and writes one docs/issues/NC-<item>.json record for each needs-code item that has none. The Actions executor, which runs on GitHub's built-in
token, takes those records in driver order like any other issue. Idempotent; never overwrites a record; touches no secret.
    python3 scripts/needs_code_bridge.py [--api URL] [--limit N] [--dry-run]
"""
import argparse, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_API = "https://ultrastable.io/api/v1"


def fetch(api, limit):
    req = urllib.request.Request(f"{api}/work?view=blocked&limit={limit}", headers={"user-agent": "ultrastable-needs-code-bridge"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("items", [])


def record(item):
    triage = re.sub(r"^needs-code:\s*", "", item.get("blocker") or "")
    body = (f"**Owner:** {item.get('owner_role') or 'operations'}\n**Trigger:** the backlog item {item['id']} was parked needs-code by the in-tick doer\n"
            f"**Done check:** {item.get('done_check') or 'the change is merged and its closing probe passes'}\n**Status:** open\n\n"
            f"{item.get('title')}\n\nTriage: {triage}\n\nBridged from the backlog by scripts/needs_code_bridge.py (NEEDS-CODE-BRIDGE-1). "
            f"The change is code, data or a test that a loop consumes; a document alone does not close it.")
    return {"id": f"NC-{item['id']}", "title": f"NC-{item['id']}: {item.get('title') or item['id']}"[:200], "body": body, "labels": ["role:" + (item.get("owner_role") or "operations"), "ws:platform", "needs-code"], "workstream": "platform"}


def bridge(items, root=ROOT, dry=False):
    out = Path(root) / "docs" / "issues"; made = []
    for it in items:
        if not (it.get("blocker") or "").startswith("needs-code:"):
            continue
        rec = record(it); path = out / f"{rec['id']}.json"
        if path.exists():
            continue
        if not dry:
            out.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
        made.append(rec["id"])
    return made


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--api", default=DEFAULT_API); ap.add_argument("--limit", type=int, default=100); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    try:
        items = fetch(a.api, a.limit)
    except Exception as e:  # a failed read is recorded by the caller's step log and retried on the next run; the executor still works the rest of the queue
        print(f"needs-code bridge: could not read {a.api}: {e}", file=sys.stderr); return 0
    made = bridge(items, dry=a.dry_run)
    print(f"needs-code bridge: {len(made)} record(s) written" + (": " + ", ".join(made[:8]) if made else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
