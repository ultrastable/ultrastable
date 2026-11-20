#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# SPDX-License-Identifier: Apache-2.0
# MAINWRITER-FALLBACK-1: land a data commit made in a workflow. Order: the main-writer route (tools/push_main.py), then a branch plus a pull request with
# auto-merge so the lane merges it after `checks`. Exit 0 only when the data reached main or a pull request carries it.
# Usage: land_data.py "<commit message>" <path>...   (paths are git-added; nothing else is committed)
import os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def sh(*a, check=True): return subprocess.run(a, cwd=ROOT, check=check, capture_output=True, text=True)

def main(msg, paths):
    sh("git", "config", "user.name", "ultrastable-data"); sh("git", "config", "user.email", "actions@users.noreply.github.com")
    sh("git", "add", "-A", *paths, check=False)
    if sh("git", "diff", "--cached", "--quiet", check=False).returncode == 0:
        print("land_data: nothing to commit"); return 0
    sh("git", "commit", "-q", "-m", msg + " [skip ci]")
    if subprocess.run(["python3", "tools/push_main.py"], cwd=ROOT).returncode == 0:
        return 0
    br = "agent/data-" + os.environ.get("GITHUB_RUN_ID", "local")
    p = sh("git", "push", "-q", "origin", f"HEAD:refs/heads/{br}", check=False)
    if p.returncode: print("land_data: branch push failed:", p.stderr.strip()[:200]); return 1
    pr = sh("gh", "pr", "create", "--base", "main", "--head", br, "--title", msg, "--body", "MAINWRITER-FALLBACK-1: data written by a workflow whose main-writer route was refused.\n\nItem: MAINWRITER-FALLBACK-1", check=False)
    print("land_data: pull request:", (pr.stdout or pr.stderr).strip()[:200])
    if pr.returncode: return 1
    sh("gh", "pr", "merge", br, "--auto", "--squash", check=False)
    # A pull request opened with the workflow token starts no workflows, so the required `checks` never ran and the PR stayed blocked: run it on the branch.
    d = sh("gh", "workflow", "run", "checks.yml", "--ref", br, check=False)
    print("land_data: checks dispatched" if d.returncode == 0 else "land_data: checks dispatch failed: " + (d.stderr or "").strip()[:200])
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2:]))
