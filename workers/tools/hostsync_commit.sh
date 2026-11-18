#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
# HOSTSYNC-1: commit ops/hosting to main without ever conflicting. The state and expected-hash files are whole-file facts (the newest wins);
# events.jsonl is append-only, so only the lines main does not yet hold are added. Fails loudly if the push never lands.
set -euo pipefail
msg="$1"
tmp=$(mktemp -d); cp -r ops/hosting/. "$tmp/"
git config user.name "ultrastable-bot"; git config user.email "bot@users.noreply.github.com"
for i in 1 2 3 4 5; do
  git fetch -q origin main
  git reset -q --hard origin/main
  mkdir -p ops/hosting
  for f in state.json expected.json; do [ -f "$tmp/$f" ] && cp "$tmp/$f" "ops/hosting/$f"; done
  if [ -f "$tmp/events.jsonl" ]; then
    touch ops/hosting/events.jsonl
    grep -vxFf ops/hosting/events.jsonl "$tmp/events.jsonl" >> ops/hosting/events.jsonl || true
  fi
  git add ops/hosting
  git diff --cached --quiet && exit 0
  git commit -q -m "$msg"
  git push -q origin HEAD:main && exit 0
  sleep $((i * 3))
done
echo "hostsync_commit: push to main did not land after 5 attempts" >&2
exit 1
