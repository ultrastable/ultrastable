#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable
"""Closing probes for queue items that live in other repositories or services (exit 0 = done). Unauthenticated where the repo is public, `gh api` otherwise.
  fleet_probe.py release-v0.1.0 | codeowners-removed | org-repos-live | cf-account | ext-x1-x3
"""
import subprocess, sys


def gh(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=60)
    return r.returncode == 0, (r.stdout or r.stderr)[:200]


def main(name):
    if name == "release-v0.1.0":
        ok, o = gh("repos/ultrastable/workers/releases/tags/v0.1.0")
    elif name == "codeowners-removed":
        ok, o = gh("repos/ultrastable/workers/contents/.github/CODEOWNERS")
        ok = not ok  # done when the file is gone
    elif name == "org-repos-live":
        a, _ = gh("repos/ultrastable/.github"); ok, o = a, "org profile repo readable"
    elif name == "cf-account":
        r = subprocess.run([sys.executable, "scripts/cf_account.py", "probe"], capture_output=True, text=True, timeout=60)
        ok, o = r.returncode == 0 and "target" in r.stdout and "true" in r.stdout.lower(), r.stdout[-200:] or r.stderr[-200:]
    elif name == "ext-x1-x3":
        ok, o = False, "pending: closing probes for X-1 and X-3 come from the dependency-unification record"
    else:
        ok, o = False, f"unknown probe {name}"
    print(("ok " if ok else "open ") + o)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
