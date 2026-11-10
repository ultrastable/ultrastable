#!/usr/bin/env bash
# METRICS-1: scoreboard in the job summary. Targets: breached 0, open PRs 0, stuck PRs 0.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
r="${GITHUB_REPOSITORY:?}"
o=$(gh issue list -R "$r" --state open --limit 500 --json number --jq length)
b=$(gh issue list -R "$r" --state open --label sla:breached --limit 500 --json number --jq length)
p=$(gh pr list -R "$r" --state open --json number --jq length)
m=$(gh pr list -R "$r" --state merged --limit 100 --json number --jq length)
{ echo "### scoreboard"; echo "open issues $o | sla breached $b | open PRs $p | merged (last 100) $m"; } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

safe_exit
