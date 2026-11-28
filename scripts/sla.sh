#!/usr/bin/env bash
# SLA-1: nothing sits. Issues past SLA are flagged then escalated; stuck PRs are closed and re-filed as issues.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
issues_or_exit
repo="${GITHUB_REPOSITORY:?}"; now=$(date +%s)
hrs() { case "$1" in p0) echo 4;; p1) echo 24;; p2) echo 72;; *) echo 168;; esac; }
up() { case "$1" in p3) echo p2;; p2) echo p1;; *) echo p0;; esac; }
gh issue list -R "$repo" --state open --limit 300 --json number,createdAt,labels | jq -c '.[]' | while read -r i; do
  n=$(jq -r .number <<<"$i"); l=",$(jq -r '[.labels[].name]|join(",")' <<<"$i"),"
  p=""; for x in p0 p1 p2 p3; do case "$l" in *,$x,*) p=$x; break;; esac; done
  [ -z "$p" ] && continue
  case "$l" in *,hold,*|*,gate:filed,*|*,"m:After filing",*|*,later,*) continue;; esac
  # GH-MIRROR-1: `queue` issues mirror docs/issues files the queue loop owns. A work record (label `work`, WORK-RECORD-1) has no file: `worklog reap` adds `queue`
  # to it, which used to exempt it from this clock, so records sat for days past their SLA with their priority unchanged. It is aged like any other issue.
  case "$l" in *,work,*) ;; *,queue,*) continue;; esac
  age=$(( (now - $(date -d "$(jq -r .createdAt <<<"$i")" +%s)) / 3600 )); sla=$(hrs "$p")
  if [ "$age" -gt "$sla" ]; then
    case "$l" in
      *,sla:breached,*) ;;
      *) gh issue edit "$n" -R "$repo" --add-label sla:breached >/dev/null 2>&1
         gh issue comment "$n" -R "$repo" --body "sla: ${age}h open, $p SLA is ${sla}h. Breached." >/dev/null 2>&1; echo "#$n breached";;
    esac
  fi
  if [ "$age" -gt $((sla*2)) ]; then
    case "$l" in
      *,sla:escalated,*|*,p0,*) ;;
      *) np=$(up "$p")
         gh issue edit "$n" -R "$repo" --remove-label "$p" --add-label "$np,sla:escalated" >/dev/null 2>&1
         gh issue comment "$n" -R "$repo" --body "sla: ${age}h open, over 2x SLA. Escalated $p to $np." >/dev/null 2>&1; echo "#$n escalated";;
    esac
  fi
done
gh pr list -R "$repo" --state open --json number,title,updatedAt,labels,headRefName | jq -c '.[]' | while read -r r; do
  n=$(jq -r .number <<<"$r"); l=",$(jq -r '[.labels[].name]|join(",")' <<<"$r"),"
  case "$l" in *,hold,*) continue;; esac
  age=$(( (now - $(date -d "$(jq -r .updatedAt <<<"$r")" +%s)) / 3600 ))
  lim=48
  # NEEDS-PAT-1: a PR labeled needs-pat that is neither conflicting nor failing waits on the workflow credential with a default in effect
  # (it stays open); the lane merges it on the pass after one is bound, so the stuck-PR clock does not close it.
  case "$l" in *,conflict,*) lim=12;; *,ci-failed,*) lim=24;; *,needs-pat,*) continue;; esac
  if [ "$age" -gt "$lim" ]; then
    t=$(jq -r .title <<<"$r")
    gh issue create -R "$repo" --title "Redo PR #$n: $t" --label p2 --body "PR #$n sat ${age}h (limit ${lim}h, labels: $l) and was closed by the SLA sweep. Redo the change from main; branch $(jq -r .headRefName <<<"$r") is kept." >/dev/null 2>&1
    gh pr close "$n" -R "$repo" --comment "sla: no progress in ${age}h (limit ${lim}h). Closed and re-filed as an issue; branch kept." >/dev/null 2>&1
    echo "PR #$n closed by SLA"
  fi
done

safe_exit
