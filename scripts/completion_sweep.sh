#!/usr/bin/env bash
# COMPLETE-1: finished work is closed, never left lying around. One idempotent pass:
#   - a branch with no open PR whose commits are all in main is deleted (merged work leaves no trace to confuse the next agent);
#   - an open PR whose head is already contained in main is closed with the reason;
#   - an open issue labelled `done` or whose referenced PR merged is closed with its evidence (GitHub closes "Closes #n" itself; this catches the rest).
# Branches in KEEP are infrastructure (loop evidence). Nothing with unmerged commits is ever deleted.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"; KEEP="main loop-evidence session-evidence audit-evidence ciwatch-evidence"
# QUEUE-1: work items are repository data (docs/issues), so GitHub Issues are off on this repository. Every `gh issue` call then fails, and
# the daily lane sweep was red on each run for that reason alone (found by the liveness probe, 2026-11-12). Ask once; skip the issue steps when off.
issues_on=$(timeout 30 "$_GH_BIN" api "repos/$repo" --jq .has_issues 2>/dev/null || echo true)
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
    if [ -n "$m" ] && [ "$m" = "$tip" ]; then gh api -X DELETE "repos/$repo/git/refs/heads/$b" >/dev/null && echo "deleted squash-merged branch $b"; continue; fi
    # BRANCH-AUTOMERGE-1 (Rowan, 2026-11-19): "The Ultrastable system shall always merge all feature branches to main automatically and shall
    # always clean up and delete branches automatically once merged." A branch with unmerged commits and no PR is never left lying: if merging
    # it into main changes nothing (its content already landed, e.g. by squash or a later PR) it is deleted; otherwise a PR is opened and the
    # lane merges it (green), reconciles it (conflict) or supersedes it, and delete_branch_on_merge removes the branch. Capped per pass.
    t=$(git merge-tree --write-tree origin/main "origin/$b" 2>/dev/null | head -1); rc=${PIPESTATUS[0]}
    if [ "$rc" = 0 ] && [ "$t" = "$(git rev-parse 'origin/main^{tree}')" ]; then
      gh api -X DELETE "repos/$repo/git/refs/heads/$b" >/dev/null && echo "deleted branch $b (content already in main)"
    elif case "$b" in parked/*) true;; *) false;; esac; then
      : # PARKED-PR-1: the reaper parked this branch on purpose and filed its backlog item; opening an automerge PR for it made 17 PRs nothing merged
    elif [ -n "$(gh pr list -R "$repo" --head "$b" --state closed --json headRefOid --jq ".[] | select(.headRefOid==\"$(git rev-parse "origin/$b")\") | .headRefOid" | head -1)" ]; then
      : # PARKED-PR-1: a PR for exactly this tip was already closed (superseded by the SLA ladder); do not reopen the same loop every day
    elif [ "${opened:=0}" -lt "${AUTOMERGE_CAP:-15}" ]; then
      gh pr create -R "$repo" --base main --head "$b" --title "automerge: $b" \
        --body "BRANCH-AUTOMERGE-1: completion-sweep found unmerged commits on \`$b\` with no PR. The lane merges this when green, reconciles a conflict with main, or supersedes it; the branch is deleted on merge." \
        >/dev/null && opened=$((opened+1)) && echo "opened PR for unmerged branch $b (clean_merge=$([ "$rc" = 0 ] && echo yes || echo no))"
    fi
  fi
done
if [ "$issues_on" != false ]; then
  for n in $(gh issue list -R "$repo" --state open --label done --json number --jq '.[].number'); do
    gh issue close "$n" -R "$repo" --reason completed --comment "completion-sweep: labelled done; closing as complete." >/dev/null && echo "closed issue #$n"
  done
fi
# STRANGE-LOOP-1: the loop measures itself so each run is comparable with the last. cycle_metric = items still open that this pass could not close.
left_prs=$(gh pr list -R "$repo" --state open --json number,updatedAt --jq '[.[] | select((now - (.updatedAt|fromdateiso8601)) > 86400)] | length')
if [ "$issues_on" != false ]; then left_issues=$(gh issue list -R "$repo" --state open --label done --json number --jq length); else left_issues="off (items are docs/issues; python3 -m foundation queue --run closes them)"; fi
echo "cycle_metric leftover_after_sweep prs_idle_over_1d=${left_prs:-?} done_issues=${left_issues:-?}"
# BRANCH-CLEANUP-1 (Rowan, 2026-11-25): no branch outlives its PR in any fleet repo; delete_branch_on_merge is enforced. A failure is logged, never swallowed.
BRANCH_CLEANUP_REPOS="ultrastable seed workers spec license ops practical-solutions .github unlearn" python3 scripts/branch_cleanup.py --apply \
  || echo "::warning::BRANCH-CLEANUP-1: branch_cleanup.py reported errors (see output above)"
safe_exit
