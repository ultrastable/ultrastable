#!/usr/bin/env bash
# Append this run's executor provenance (ops/executor-log.jsonl) to branch loop-evidence, the shared evidence branch.
# Failures are loud: a failed push exits non-zero.
set -euo pipefail
[ -f ops/executor-log.jsonl ] || { echo "no executor rows this run"; exit 0; }
cp ops/executor-log.jsonl "${RUNNER_TEMP:-/tmp}/rows.jsonl"
# SELFCODE-1: the self-code ledger (filed, kept, reverted per signal kind) travels on the same evidence branch
[ -f ops/selfcode/ledger.jsonl ] && cp ops/selfcode/ledger.jsonl "${RUNNER_TEMP:-/tmp}/selfcode.jsonl" || : > "${RUNNER_TEMP:-/tmp}/selfcode.jsonl"
# FREE-LLM-1: per-call model outcomes (which rung answered, why one failed) travel on the same branch
[ -f ops/agent-cost.jsonl ] && cp ops/agent-cost.jsonl "${RUNNER_TEMP:-/tmp}/cost.jsonl" || : > "${RUNNER_TEMP:-/tmp}/cost.jsonl"
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
mkdir -p ops/selfcode; touch ops/selfcode/ledger.jsonl
grep -vxFf ops/selfcode/ledger.jsonl "${RUNNER_TEMP:-/tmp}/selfcode.jsonl" > "${RUNNER_TEMP:-/tmp}/selfnew.jsonl" || true
touch ops/agent-cost.jsonl
grep -vxFf ops/agent-cost.jsonl "${RUNNER_TEMP:-/tmp}/cost.jsonl" > "${RUNNER_TEMP:-/tmp}/costnew.jsonl" || true
cat "${RUNNER_TEMP:-/tmp}/costnew.jsonl" >> ops/agent-cost.jsonl
[ -s "${RUNNER_TEMP:-/tmp}/costnew.jsonl" ] || [ -s "${RUNNER_TEMP:-/tmp}/new.jsonl" ] || [ -s "${RUNNER_TEMP:-/tmp}/selfnew.jsonl" ] || { echo "no new executor or self-code rows this run"; exit 0; }
cat "${RUNNER_TEMP:-/tmp}/new.jsonl" >> ops/executor-log.jsonl
cat "${RUNNER_TEMP:-/tmp}/selfnew.jsonl" >> ops/selfcode/ledger.jsonl
git add ops/executor-log.jsonl ops/selfcode/ledger.jsonl ops/agent-cost.jsonl; git commit -m "executor provenance"; git push origin loop-evidence
