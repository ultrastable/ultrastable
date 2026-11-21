#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TEMPORAL-1: file a tenant's temporal findings (ops/temporal/tenants/<id>/to_file.json) as issues in the tenant's own repository, where its agents take them.
Idempotent: an issue whose title already exists (open or closed) is skipped. A refused call is printed and the run exits 1, never swallowed.

  python3 scripts/temporal_issues.py ID OWNER/REPO"""
import json, subprocess, sys
from pathlib import Path


def main(argv) -> int:
    tid, repo = argv
    p = Path("ops/temporal/tenants") / tid / "to_file.json"
    if not p.is_file():
        print(f"{tid}: nothing to file")
        return 0
    rc = 0
    for it in json.loads(p.read_text(encoding="utf-8")):
        have = subprocess.run(["gh", "issue", "list", "--repo", repo, "--state", "all", "--search", f'"{it["id"]}" in:title', "--json", "number", "--jq", "length"], capture_output=True, text=True)
        if have.returncode == 0 and have.stdout.strip() not in ("", "0"):
            print(f"{it['id']}: already filed")
            continue
        r = subprocess.run(["gh", "issue", "create", "--repo", repo, "--title", it["title"], "--body", it["body"], "--label", ",".join(it["labels"])], capture_output=True, text=True)
        print(f"{it['id']}: {'filed ' + r.stdout.strip() if r.returncode == 0 else 'REFUSED ' + r.stderr.strip()[:200]}")
        rc |= r.returncode != 0
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
