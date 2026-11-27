#!/usr/bin/env bash
# Append this run's executor provenance (ops/executor-log.jsonl) to branch loop-evidence, the shared evidence branch.
# Failures are loud: a failed push exits non-zero.
set -euo pipefail
[ -f ops/executor-log.jsonl ] || [ -f ops/route-health.jsonl ] || { echo "no executor rows this run"; exit 0; }
[ -f ops/executor-log.jsonl ] && cp ops/executor-log.jsonl "${RUNNER_TEMP:-/tmp}/rows.jsonl" || : > "${RUNNER_TEMP:-/tmp}/rows.jsonl"
# ROUTE-CANARY-1: the canary rows travel with the rest, so routehealth --probe reads them from loop-evidence
[ -f ops/route-health.jsonl ] && cp ops/route-health.jsonl "${RUNNER_TEMP:-/tmp}/health.jsonl" || : > "${RUNNER_TEMP:-/tmp}/health.jsonl"
# SELFCODE-1: the self-code ledger (filed, kept, reverted per signal kind) travels on the same evidence branch
[ -f ops/selfcode/ledger.jsonl ] && cp ops/selfcode/ledger.jsonl "${RUNNER_TEMP:-/tmp}/selfcode.jsonl" || : > "${RUNNER_TEMP:-/tmp}/selfcode.jsonl"
# FREE-LLM-1: per-call model outcomes (which rung answered, why one failed) travel on the same branch
[ -f ops/agent-cost.jsonl ] && cp ops/agent-cost.jsonl "${RUNNER_TEMP:-/tmp}/cost.jsonl" || : > "${RUNNER_TEMP:-/tmp}/cost.jsonl"
# EVIDENCE-RETURN-1: this script used to leave the checkout on loop-evidence, so every later step of the job (clock --chain, clock --heal) ran that
# branch's old copy of the code and data: the wake cap merged in #727 never took effect (2026-11-20). The job returns to the commit it started on.
START=$(git rev-parse HEAD)
trap 'git checkout -q --detach "$START" 2>/dev/null || echo "::warning::could not return to $START"' EXIT
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
touch ops/route-health.jsonl
grep -vxFf ops/route-health.jsonl "${RUNNER_TEMP:-/tmp}/health.jsonl" > "${RUNNER_TEMP:-/tmp}/healthnew.jsonl" || true
cat "${RUNNER_TEMP:-/tmp}/healthnew.jsonl" >> ops/route-health.jsonl
[ -s "${RUNNER_TEMP:-/tmp}/healthnew.jsonl" ] || [ -s "${RUNNER_TEMP:-/tmp}/costnew.jsonl" ] || [ -s "${RUNNER_TEMP:-/tmp}/new.jsonl" ] || [ -s "${RUNNER_TEMP:-/tmp}/selfnew.jsonl" ] || { echo "no new executor or self-code rows this run"; exit 0; }
cat "${RUNNER_TEMP:-/tmp}/new.jsonl" >> ops/executor-log.jsonl
cat "${RUNNER_TEMP:-/tmp}/selfnew.jsonl" >> ops/selfcode/ledger.jsonl
git add ops/executor-log.jsonl ops/selfcode/ledger.jsonl ops/agent-cost.jsonl ops/route-health.jsonl; git commit -m "executor provenance"; git push origin loop-evidence
