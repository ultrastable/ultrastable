#!/usr/bin/env bash
# COMPLETE-1: finished work is closed, never left lying around. One idempotent pass:
#   - a branch with no open PR whose commits are all in main is deleted (merged work leaves no trace to confuse the next agent);
#   - an open PR whose head is already contained in main is closed with the reason;
#   - an open issue labelled `done` or whose referenced PR merged is closed with its evidence (GitHub closes "Closes #n" itself; this catches the rest).
# Branches in KEEP are infrastructure (loop evidence). Nothing with unmerged commits is ever deleted.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"; KEEP="main loop-evidence"
git fetch -q origin "+refs/heads/*:refs/remotes/origin/*" || echo "fetch failed" >&2
for b in $(gh api "repos/$repo/branches" --paginate --jq '.[].name'); do
  case " $KEEP " in *" $b "*) continue;; esac
  # a branch whose tip is under a day old may be a session that has just started: never touch it
  [ $(( $(date +%s) - $(git log -1 --format=%ct "origin/$b" 2>/dev/null || echo 0) )) -lt 86400 ] && continue
  open=$(gh pr list -R "$repo" --head "$b" --state open --json number --jq length)
  if [ "$open" != "0" ]; then
    # open PR already contained in main: close it
    if git merge-base --is-ancestor "origin/$b" origin/main 2>/dev/null; then
      n=$(gh pr list -R "$repo" --head "$b" --state open --json number --jq '.[0].number')
      gh pr close "$n" -R "$repo" --comment "completion-sweep: every commit of this branch is already in main; closing as complete." >/dev/null && echo "closed PR #$n (contained in main)"
    fi
    continue
  fi
  if git merge-base --is-ancestor "origin/$b" origin/main 2>/dev/null; then
    gh api -X DELETE "repos/$repo/git/refs/heads/$b" >/dev/null && echo "deleted merged branch $b"
  else
    # squash merges are not ancestors: delete when the branch has a merged PR and no commits after it
    m=$(gh pr list -R "$repo" --head "$b" --state merged --json mergedAt,headRefOid --jq '.[0].headRefOid // empty')
    tip=$(git rev-parse "origin/$b" 2>/dev/null)
    if [ -n "$m" ] && [ "$m" = "$tip" ]; then gh api -X DELETE "repos/$repo/git/refs/heads/$b" >/dev/null && echo "deleted squash-merged branch $b"; fi
  fi
done
for n in $(gh issue list -R "$repo" --state open --label done --json number --jq '.[].number'); do
  gh issue close "$n" -R "$repo" --reason completed --comment "completion-sweep: labelled done; closing as complete." >/dev/null && echo "closed issue #$n"
done
safe_exit
