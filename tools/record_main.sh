#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# DEPLOY-RECORD-MERGE-1 (2026-11-21): workflows that record data on main ran `git pull --rebase`, which stopped on generated claim blocks in
# README.md and failed deploy-workers (run 44927206546). One shared route: commit the staged record, merge main, resolve generated and
# append-only files by rule (scripts/resolve_generated.py), regenerate claims, push through tools/push_main.py; three attempts, then fail loudly.
# Usage: tools/record_main.sh "<commit message>"   (stage files first)
set -euo pipefail
git diff --cached --quiet && { echo "record_main: nothing to record"; exit 0; }
git commit -q -m "$1"
for i in 1 2 3; do
  git fetch -q origin main
  if ! git merge -q --no-edit origin/main; then
    python3 scripts/resolve_generated.py || { git merge --abort; echo "::error::record_main: conflict outside generated files"; exit 1; }
    python3 -m foundation claims --fix --apply
    git add -u
    git commit -q --no-edit
  fi
  python3 tools/push_main.py && exit 0
  sleep $((i * 5))
done
echo "::error::record_main: could not push after 3 attempts"; exit 1
