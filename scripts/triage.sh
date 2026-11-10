#!/usr/bin/env bash
# TRIAGE-1: every open issue gets a priority (p0-p3), an SLA comment and an owner lane within the hour.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"
for n in $(gh issue list -R "$repo" --state open --limit 300 --json number --jq '.[].number'); do
  l=",$(gh issue view "$n" -R "$repo" --json labels --jq '[.labels[].name]|join(",")'),"
  case "$l" in *,sla:set,*) continue;; esac
  p=p2
  case "$l" in
    *,p0,*|*,p1,*|*,p2,*|*,p3,*) p="";;
    *,m:Now,*) p=p1;;
    *,m:Next,*) p=p2;;
    *,m:Later,*|*,"m:After filing",*) p=p3;;
  esac
  add="sla:set"; [ -n "$p" ] && add="$add,$p"
  case "$l" in
    *,m:Later,*|*,"m:After filing",*|*,gate:filed,*) ;;
    *) add="$add,agent-ready";;
  esac
  gh issue edit "$n" -R "$repo" --add-label "$add" >/dev/null 2>&1
  gh issue comment "$n" -R "$repo" --body "triage: priority ${p:-set by label}. SLA: p0 4h, p1 24h, p2 72h, p3 7d from creation. A breach escalates one level (docs/AUTOMATION.md)." >/dev/null 2>&1
  case "$add" in *agent-ready*) gh api -X POST "repos/$repo/issues/$n/assignees" -f 'assignees[]=copilot-swe-agent[bot]' >/dev/null 2>&1 || true;; esac
  echo "#$n triaged $add"
done

safe_exit
