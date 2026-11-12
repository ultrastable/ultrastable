#!/usr/bin/env bash
# LANE-1: one pass over every open PR into main. Idempotent; runs on PR events, check completions and every 10 minutes.
# Draft -> ready, wait for green checks, auto-review, squash merge. Conflicts are escalated, never left to sit.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"
for n in $(gh pr list -R "$repo" --state open --base main --json number --jq '.[].number'); do
  v=$(gh pr view "$n" -R "$repo" --json isDraft,headRefName,headRefOid,labels,mergeable,updatedAt)
  draft=$(jq -r .isDraft <<<"$v"); sha=$(jq -r .headRefOid <<<"$v"); br=$(jq -r .headRefName <<<"$v")
  labels=",$(jq -r '[.labels[].name]|join(",")' <<<"$v"),"; mg=$(jq -r .mergeable <<<"$v")
  case "$labels" in *,hold,*) echo "#$n hold"; continue;; esac
  if [ "$draft" = true ]; then
    if gh pr ready "$n" -R "$repo" >/dev/null 2>&1; then echo "#$n marked ready"; else echo "#$n ready failed"; continue; fi
  fi
  if [ "$mg" = UNKNOWN ]; then sleep 4; mg=$(gh pr view "$n" -R "$repo" --json mergeable --jq .mergeable); fi
  if [ "$mg" = CONFLICTING ]; then
    case "$labels" in
      *,conflict,*) ;;
      *) gh pr edit "$n" -R "$repo" --add-label conflict >/dev/null 2>&1
         gh pr comment "$n" -R "$repo" --body "lane: merge conflict with main. Rebase within 12h or this PR is closed and re-filed as an issue (SLA)." >/dev/null 2>&1;;
    esac
    echo "#$n conflict"; continue
  fi
  runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[]|select(.name!="lane")]')
  total=$(jq length <<<"$runs")
  pending=$(jq '[.[]|select(.status!="completed")]|length' <<<"$runs")
  bad=$(jq '[.[]|select(.status=="completed" and ((.conclusion|IN("success","neutral","skipped"))|not))]|length' <<<"$runs")
  if [ "$total" -eq 0 ]; then
    age=$(( $(date +%s) - $(date -d "$(jq -r .updatedAt <<<"$v")" +%s) ))
    if [ "$age" -gt 300 ]; then
      if gh workflow run checks.yml -R "$repo" --ref "$br" >/dev/null 2>&1; then echo "#$n dispatched checks"; fi
    fi
    continue
  fi
  if [ "$bad" -gt 0 ]; then
    case "$labels" in
      *,ci-failed,*) ;;
      *) gh pr edit "$n" -R "$repo" --add-label ci-failed >/dev/null 2>&1
         gh pr comment "$n" -R "$repo" --body "lane: a check failed on ${sha:0:7}. Fix within 24h or this PR is closed and re-filed as an issue (SLA)." >/dev/null 2>&1;;
    esac
    echo "#$n ci-failed"; continue
  fi
  if [ "$pending" -gt 0 ]; then echo "#$n pending"; continue; fi
  case "$labels" in
    *,ci-failed,*|*,conflict,*) gh pr edit "$n" -R "$repo" --remove-label ci-failed --remove-label conflict >/dev/null 2>&1;;
  esac
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    rv=$(gh pr diff "$n" -R "$repo" 2>/dev/null | python3 "$(dirname "$0")/llm_review.py"); rc=$?
    if [ "$rc" -eq 2 ]; then
      gh pr edit "$n" -R "$repo" --add-label hold >/dev/null 2>&1
      gh pr comment "$n" -R "$repo" --body "$rv"$'

lane: held on a High finding. Fix and remove the hold label.' >/dev/null 2>&1
      echo "#$n held by llm-review"; continue
    fi
  fi
  gh pr review "$n" -R "$repo" --approve --body "auto-review: all checks green on ${sha:0:7} (secret scan, workflow lint, repo verify)." >/dev/null 2>&1 || true
  # A concurrent lane pass already merging this PR is a benign race, not a degraded run: call gh directly so it is not counted.
  if out=$(timeout "${GH_TIMEOUT:-60}" "$_GH_BIN" pr merge "$n" -R "$repo" --squash --delete-branch --match-head-commit "$sha" 2>&1); then
    echo "#$n merged"
    # DEPLOY-1: merges made with GITHUB_TOKEN never fire push workflows, so the lane dispatches the deploy itself when the PR touched deployable paths.
    if gh pr diff "$n" -R "$repo" --name-only 2>/dev/null | grep -qE '^(site/|seed/analytics/|deploy/deploy-site\.mjs)'; then
      gh workflow run deploy-site.yml -R "$repo" --ref main >/dev/null 2>&1 && echo "#$n dispatched deploy-site"
    fi
  else
    echo "#$n merge failed: $out"
    case "$out" in *"already in progress"*|*"already merged"*) continue;; esac
    echo x >>"$_SAFE_FAILS"
    case "$out" in *workflow*) gh pr edit "$n" -R "$repo" --add-label needs-pat >/dev/null 2>&1;; esac
  fi
done

safe_exit
