#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
# HOSTSYNC-1: commit ops/hosting to main without ever conflicting. The state file is a whole-file fact (the newest wins); expected-hash keys are merged;
# events.jsonl is append-only, so only the lines main does not yet hold are added. Fails loudly if the push never lands.
set -euo pipefail
msg="$1"
tmp=$(mktemp -d); cp -r ops/hosting/. "$tmp/"
git config user.name "ultrastable-bot"; git config user.email "bot@users.noreply.github.com"
for i in 1 2 3 4 5; do
  git fetch -q origin main
  git reset -q --hard origin/main
  mkdir -p ops/hosting
  [ -f "$tmp/state.json" ] && cp "$tmp/state.json" ops/hosting/state.json
  # expected.json holds one key per script, written by separate deploy jobs: merge ours over main's, never replace the file.
  if [ -f "$tmp/expected.json" ]; then
    node -e 'const fs=require("fs");const [a,b]=process.argv.slice(1);const m=fs.existsSync(a)?JSON.parse(fs.readFileSync(a,"utf8")):{};const o=JSON.parse(fs.readFileSync(b,"utf8"));const r={...m,...o};fs.writeFileSync(a,JSON.stringify(Object.fromEntries(Object.entries(r).sort()),null,1)+"\n")' ops/hosting/expected.json "$tmp/expected.json"
  fi
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
