#!/usr/bin/env bash
# Append this run's executor provenance (ops/executor-log.jsonl) to branch loop-evidence, the shared evidence branch.
# Failures are loud: a failed push exits non-zero.
set -euo pipefail
[ -f ops/executor-log.jsonl ] || { echo "no executor rows this run"; exit 0; }
cp ops/executor-log.jsonl "${RUNNER_TEMP:-/tmp}/rows.jsonl"
git config user.name ultrastable-executor; git config user.email executor@users.noreply.github.com
git checkout -- . ; git clean -fdq
if git ls-remote --exit-code --heads origin loop-evidence >/dev/null; then
  git fetch origin loop-evidence; git checkout -B loop-evidence FETCH_HEAD
else
  git checkout --orphan loop-evidence; git rm -rfq .
fi
mkdir -p ops; cat "${RUNNER_TEMP:-/tmp}/rows.jsonl" >> ops/executor-log.jsonl
git add ops/executor-log.jsonl; git commit -m "executor provenance"; git push origin loop-evidence
