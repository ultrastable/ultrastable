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
# EVIDENCE-DEDUP-1: the working copy starts with the rows committed on main, so appending the whole file re-wrote main's rows on every run
# (one 2026-11-12 row appeared 12 times). Only lines the evidence branch does not hold yet are appended.
mkdir -p ops; touch ops/executor-log.jsonl
grep -vxFf ops/executor-log.jsonl "${RUNNER_TEMP:-/tmp}/rows.jsonl" > "${RUNNER_TEMP:-/tmp}/new.jsonl" || true
[ -s "${RUNNER_TEMP:-/tmp}/new.jsonl" ] || { echo "no new executor rows this run"; exit 0; }
cat "${RUNNER_TEMP:-/tmp}/new.jsonl" >> ops/executor-log.jsonl
git add ops/executor-log.jsonl; git commit -m "executor provenance"; git push origin loop-evidence
