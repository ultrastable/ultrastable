#!/usr/bin/env bash
# RETRIAGE-1: open PRs get merged when green or flagged; open issues without a doer and a probe get a gap issue.
# Runs from .github/workflows/retriage.yml (every 3 hours). Uses GITHUB_TOKEN permissions only; a denied action is logged, never bypassed.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
issues_or_exit
repo="${GITHUB_REPOSITORY:?}"
log() { echo "retriage: $*"; }
gaps=""

# 1. Pull requests: enable auto-merge on every non-draft PR (merges when required checks pass); flag conflicts and stale drafts.
for n in $(gh pr list -R "$repo" --state open --json number --jq '.[].number'); do
  info=$(gh pr view "$n" -R "$repo" --json isDraft,mergeable,labels,updatedAt,title --jq '[.isDraft,.mergeable,([.labels[].name]|join(",")),.updatedAt,.title]|join("|")')
  # A non-whitespace separator: read collapses consecutive tabs, so an empty label list shifted every later field (updated took the title).
  IFS='|' read -r draft mergeable labels updated title <<<"$info"
  case ",$labels," in *,superseded,*) gh pr close "$n" -R "$repo" -c "Closed by retriage: labelled superseded." >/dev/null && log "#$n closed (superseded)"; continue;; esac
  if [ "$draft" = "true" ]; then
    age=$(( ( $(date +%s) - $(date -d "$updated" +%s) ) / 3600 ))
    [ "$age" -gt 24 ] && { gaps="$gaps\n- PR #$n is a draft idle for ${age}h: $title"; }
    continue
  fi
  case "$mergeable" in
    CONFLICTING) gaps="$gaps\n- PR #$n conflicts with main: $title"; gh pr edit "$n" -R "$repo" --add-label conflict >/dev/null 2>&1 || true;;
    *) if gh pr merge "$n" -R "$repo" --squash --auto >/dev/null 2>"/tmp/merge-$n.err"; then log "#$n auto-merge enabled"; else log "#$n merge denied: $(tr '\n' ' ' < /tmp/merge-$n.err)"; gaps="$gaps\n- PR #$n could not be set to auto-merge: $(head -c 160 /tmp/merge-$n.err | tr '\n' ' ')"; fi;;
  esac
done

# 2. Issues: each open issue needs a doer (assignee or agent-ready or owner-card) and a closing probe (the word "probe" or "done check" in body, or a gate/later label).
for n in $(gh issue list -R "$repo" --state open --limit 300 --json number --jq '.[].number'); do
  row=$(gh issue view "$n" -R "$repo" --json labels,assignees,body,title --jq '[([.labels[].name]|join(",")),(.assignees|length),((.body // "")|test("probe|done check";"i")),.title]|map(tostring)|join("|")')
  IFS='|' read -r labels nassign hasprobe title <<<"$row"
  doer=false; case ",$labels," in *,agent-ready,*|*,owner-card,*|*,gate:filed,*|*,m:Later,*) doer=true;; esac
  [ "$nassign" != "0" ] && doer=true
  [ "$doer" = false ] && gaps="$gaps\n- issue #$n has no doer: $title"
  [ "$hasprobe" != "true" ] && case ",$labels," in *,gate:filed,*|*,m:Later,*|*,m:After\ filing,*) ;; *) gaps="$gaps\n- issue #$n has no closing probe: $title";; esac
done

# 3. File one rolling gap issue (idempotent by title).
if [ -n "$gaps" ]; then
  body=$(printf "Found by scripts/retriage.sh at %s. Closing probe: this list is empty on the next run. Each line needs a doer or a probe, or a disposition (done, superseded, cancelled, blocked with owner and probe).\n%b\n" "$(date -u +%FT%TZ)" "$gaps")
  num=$(gh issue list -R "$repo" --state open --search 'in:title "Retriage gaps"' --json number --jq '.[0].number // empty')
  if [ -n "$num" ]; then gh issue edit "$num" -R "$repo" --body "$body" >/dev/null; log "gap issue #$num updated"
  else gh issue create -R "$repo" --title "Retriage gaps" --label agent-ready --body "$body" >/dev/null && log "gap issue created"; fi
else
  log "no gaps"
  num=$(gh issue list -R "$repo" --state open --search 'in:title "Retriage gaps"' --json number --jq '.[0].number // empty')
  [ -n "$num" ] && gh issue close "$num" -R "$repo" --reason completed -c "Closed by retriage: the closing probe passed (a run found no gaps at $(date -u +%FT%TZ))." >/dev/null && log "gap issue #$num closed"
fi

safe_exit
