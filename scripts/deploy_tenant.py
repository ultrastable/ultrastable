#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""LIVE-1: deploy a tenant's runtime from the seed, the same way for tenant 0 (Ultrastable on itself) and for any child.

  python3 scripts/deploy_tenant.py --idea instances/ultrastable/IDEA.md [--dry-run]

Copies seed/ to a scratch folder (the repo is never written to), drops the tenant's IDEA.md in, and runs the bootstrapper: D1 create, migrations,
seed rows, Worker deploy with the tick cron. Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) in the environment; it never reads or prints them.
The IDEA front matter decides exposure: `public_health_only: 1` publishes /health and nothing else. After a run, record the URL in
instances/<slug>/live-runtime.json so the dashboard and the failure audit can read it.
Consumers: instances/ultrastable/live-runtime.json (documents each run), tests/foundation/test_dashboard.py."""
import argparse, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--idea", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    work = Path(tempfile.mkdtemp(prefix="tenant-"))
    dst = work / "seed"
    shutil.copytree(ROOT / "seed", dst, ignore=shutil.ignore_patterns(".git", "org", "node_modules", "__pycache__", "config.js", "wrangler.jsonc"))
    shutil.copyfile(ROOT / a.idea, dst / "IDEA.md")
    cmd = [sys.executable, str(dst / "bootstrap" / "bootstrap.py"), "--dry-run" if a.dry_run else "--apply"]
    r = subprocess.run(cmd, cwd=dst)
    print(f"workdir: {work}")
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
