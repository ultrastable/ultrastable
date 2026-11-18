#!/usr/bin/env bash
# LANE-1: one pass over every open PR into main. Idempotent; runs on PR events, check completions and every 10 minutes.
# Draft -> ready, wait for green checks, auto-review, squash merge. Conflicts are escalated, never left to sit.
# SERVER-OWNS-LOOPS-1 (owner, 2026-11-13): a PR this pass cannot merge is adopted before the pass ends (foundation/loopowner.py): one queue item
# with an owner and a closing probe, committed to main for the executor. The lane never hands a PR back to the session that opened it.
# NEEDS-PAT-1 (server-side only): a PR that changes .github/workflows/** cannot be merged with the workflow's built-in token. The lane
# merges it itself, on green and on the exact head commit, when a workflow-capable credential is bound (scripts/lane_credential.py:
# LANE_PAT, or a GitHub App installation token). With none bound it labels the PR needs-pat, leaves it open and says so; it never works
# around the refusal. The owner step and its default are in foundation/data/needs-you.json (lane-credential).
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
repo="${GITHUB_REPOSITORY:?}"
here="$(dirname "$0")"
wf_source=$(python3 "$here/lane_credential.py" source) || wf_source=none
wf_token=""; wf_waiting=0; wf_merged=0
echo "lane: workflow credential: $wf_source"
for n in $(gh pr list -R "$repo" --state open --base main --json number --jq '.[].number'); do
  v=$(gh pr view "$n" -R "$repo" --json isDraft,headRefName,headRefOid,labels,mergeable,updatedAt,files)
  draft=$(jq -r .isDraft <<<"$v"); sha=$(jq -r .headRefOid <<<"$v"); br=$(jq -r .headRefName <<<"$v")
  labels=",$(jq -r '[.labels[].name]|join(",")' <<<"$v"),"; mg=$(jq -r .mergeable <<<"$v")
  case "$labels" in *,hold,*) echo "#$n hold"; continue;; esac
  # A PR needs the workflow credential when it carries the label or its file list touches a workflow.
  wf=false
  case "$labels" in *,needs-pat,*) wf=true;; esac
  if jq -e '[.files[]?.path|select(startswith(".github/workflows/"))]|length>0' <<<"$v" >/dev/null; then wf=true; fi
  if [ "$draft" = true ]; then
    if gh pr ready "$n" -R "$repo" >/dev/null 2>&1; then echo "#$n marked ready"; else echo "#$n ready failed"; continue; fi
  fi
  if [ "$mg" = UNKNOWN ]; then sleep 4; mg=$(gh pr view "$n" -R "$repo" --json mergeable --jq .mergeable); fi
  if [ "$mg" = CONFLICTING ]; then
    # CONFLICT-CLOSE-1: the lane closes the conflict itself: merge main, resolve the generated files, push, dispatch checks. An executor PR that
    # still cannot merge is closed so its queue item is redone from main. Only a session PR with a real conflict falls through to the label.
    cr=$(python3 -m foundation conflicts --pr "$n" --apply 2>&1 | tail -1); echo "#$n conflict pass: $cr"
    case "$cr" in *'"result": "resolved"'*|*'"result": "requeued"'*) continue;; esac
    case "$labels" in
      *,conflict,*) ;;
      *) gh pr edit "$n" -R "$repo" --add-label conflict >/dev/null 2>&1
         gh pr comment "$n" -R "$repo" --body "lane: merge conflict with main. SERVER-OWNS-LOOPS: the server resolves or supersedes it on this pass (queue item OL-PR-$n)." >/dev/null 2>&1;;
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
         gh pr comment "$n" -R "$repo" --body "lane: a check failed on ${sha:0:7}. SERVER-OWNS-LOOPS: the server repairs or supersedes it on this pass (queue item OL-PR-$n)." >/dev/null 2>&1;;
    esac
    echo "#$n ci-failed"; continue
  fi
  if [ "$pending" -gt 0 ]; then echo "#$n pending"; continue; fi
  # MERGE-GATE-1: "no check failed" is not "the gate passed". A skipped or missing `checks` job (draft, HALT, a workflow that never started) left only
  # cheap checks green, and a change that broke main (#596) merged. Merge only when the `checks` job itself succeeded on this exact head commit.
  gate=$(jq '[.[]|select(.name=="checks" and .conclusion=="success")]|length' <<<"$runs")
  if [ "$gate" -eq 0 ]; then
    age=$(( $(date +%s) - $(date -d "$(jq -r .updatedAt <<<"$v")" +%s) ))
    if [ "$age" -gt 300 ] && gh workflow run checks.yml -R "$repo" --ref "$br" >/dev/null 2>&1; then echo "#$n gate: dispatched checks"; fi
    echo "#$n gate: the checks job has not succeeded on ${sha:0:7}; not merged"; continue
  fi
  case "$labels" in
    *,ci-failed,*|*,conflict,*) gh pr edit "$n" -R "$repo" --remove-label ci-failed --remove-label conflict >/dev/null 2>&1;;
  esac
  merge_token="${GH_TOKEN:-}"
  if [ "$wf" = true ]; then
    if [ "$wf_source" = none ]; then
      case "$labels" in *,needs-pat,*) ;; *) gh pr edit "$n" -R "$repo" --add-label needs-pat >/dev/null 2>&1;; esac
      wf_waiting=$((wf_waiting+1))
      echo "#$n needs-pat: green on ${sha:0:7}, not merged: no workflow-capable credential is bound (LANE_PAT, or LANE_APP_ID with LANE_APP_PRIVATE_KEY). Default in effect: it stays open."
      continue
    fi
    if [ -z "$wf_token" ]; then
      if ! wf_token=$(python3 "$here/lane_credential.py" token) || [ -z "$wf_token" ]; then
        echo "#$n needs-pat: the $wf_source credential is bound but gave no token (see the line above); not merged"; echo x >>"$_SAFE_FAILS"; wf_token=""; continue
      fi
      # A token minted at run time is not a stored secret, so the runner is told to mask it. LANE_PAT is a stored secret and already masked.
      if [ "$wf_source" = github-app ]; then echo "::add-mask::$wf_token"; fi
    fi
    merge_token="$wf_token"
  fi
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    rv=$(gh pr diff "$n" -R "$repo" 2>/dev/null | python3 "$(dirname "$0")/llm_review.py"); rc=$?
    if [ "$rc" -eq 2 ]; then
      gh pr edit "$n" -R "$repo" --add-label hold >/dev/null 2>&1
      gh pr comment "$n" -R "$repo" --body "$rv"$'

lane: held on a High finding. SERVER-OWNS-LOOPS: the server lands a superseding change without the finding and closes this one (queue item OL-PR-'"$n"').' >/dev/null 2>&1
      echo "#$n held by llm-review"; continue
    fi
  fi
  gh pr review "$n" -R "$repo" --approve --body "auto-review: all checks green on ${sha:0:7} (secret scan, workflow lint, repo verify)." >/dev/null 2>&1 || true
  # A concurrent lane pass already merging this PR is a benign race, not a degraded run: call gh directly so it is not counted.
  if out=$(GH_TOKEN="$merge_token" timeout "${GH_TIMEOUT:-60}" "$_GH_BIN" pr merge "$n" -R "$repo" --squash --delete-branch --match-head-commit "$sha" 2>&1); then
    if [ "$wf" = true ]; then wf_merged=$((wf_merged+1)); echo "#$n merged (needs-pat, with the $wf_source credential, head ${sha:0:7})"; else echo "#$n merged"; fi
    # DEPLOY-1: merges made with GITHUB_TOKEN never fire push workflows, so the lane dispatches the deploy itself when the PR touched deployable paths.
    if gh pr diff "$n" -R "$repo" --name-only 2>/dev/null | grep -qE '^(site/|seed/analytics/|deploy/deploy-site\.mjs)'; then
      gh workflow run deploy-site.yml -R "$repo" --ref main >/dev/null 2>&1 && echo "#$n dispatched deploy-site"
    fi
    # DEPLOY-ALL-1: the tick and dashboard Workers and the code-agent Worker deployed only by hand or by a person's own push; the lane dispatches them too.
    if gh pr diff "$n" -R "$repo" --name-only 2>/dev/null | grep -qE '^(seed/worker/|seed/analytics/|seed/bootstrap/questions\.json|seed/autonomy/|dashboard/|doctrine/topology\.json|deploy/deploy-workers\.mjs)'; then
      gh workflow run deploy-workers.yml -R "$repo" --ref main >/dev/null 2>&1 && echo "#$n dispatched deploy-workers"
    fi
    if gh pr diff "$n" -R "$repo" --name-only 2>/dev/null | grep -qE '^(seed/worker/src/codeagent\.js|deploy/agents-worker\.js|deploy/deploy-system\.mjs|doctrine/system\.json|doctrine/code-agents\.json)'; then
      gh workflow run deploy-system.yml -R "$repo" --ref main >/dev/null 2>&1 && echo "#$n dispatched deploy-system"
    fi
  else
    echo "#$n merge failed: $out"
    case "$out" in *"already in progress"*|*"already merged"*) continue;; esac
    echo x >>"$_SAFE_FAILS"
    case "$out" in *workflow*) gh pr edit "$n" -R "$repo" --add-label needs-pat >/dev/null 2>&1;; esac
  fi
done
echo "lane: needs-pat merged=$wf_merged waiting=$wf_waiting credential=$wf_source"
# SERVER-OWNS-LOOPS: adopt what is still open and not mergeable and commit the queue items to main, so the executor sees them on its next run
# (it starts from every finished lane). Runs only inside the lane workflow, or where LANE_ADOPT=1 is set by another server-side host.
if [ "${GITHUB_WORKFLOW:-}" = lane ] || [ "${LANE_ADOPT:-}" = 1 ]; then
  root="$(cd "$here/.." && pwd)"
  # LANE-RETRY-1: adoption output (issue files, dashboard counts, memory) is regenerated from main, so a conflict on push is never merged by hand:
  # reset to the new origin/main and run the adoption again. The old loop retried `pull --rebase` inside the unresolved rebase and failed four more times (lane run 44205928490).
  adopt_commit() {
    (cd "$root" && python3 -m foundation loopowner --adopt --apply) || { echo "lane: loopowner adopt failed" >&2; return 2; }
    # MEMORY-REFRESH-1: record merged work in the project memory before it goes stale and fails every pull request's memory check
    (cd "$root" && python3 scripts/memory_refresh.py) || echo "lane: memory refresh failed" >&2
    [ -n "$(git -C "$root" status --porcelain docs/issues docs/PROJECT-MEMORY.md)" ] || return 0
    git -C "$root" config user.name "ultrastable-lane"; git -C "$root" config user.email "actions@users.noreply.github.com"
    # LANE-DASHBOARD-1: the adoption items change the issue count the dashboard carries; rebuild it in the same commit, or main fails its own stale check
    (cd "$root" && python3 scripts/build_dashboard.py >/dev/null) || echo "lane: dashboard rebuild failed" >&2
    git -C "$root" add docs/issues site/dashboard-data.js docs/PROJECT-MEMORY.md
    git -C "$root" commit -q -m "lane: server-owned loops (SERVER-OWNS-LOOPS-1)" || return 0
    git -C "$root" push -q origin HEAD:main
  }
  pushed=0; adopt_rc=0
  for try in 1 2 3 4 5; do
    adopt_commit; adopt_rc=$?
    if [ "$adopt_rc" = 0 ]; then pushed=1; break; fi
    [ "$adopt_rc" = 2 ] && break
    git -C "$root" fetch -q origin main && git -C "$root" reset -q --hard origin/main
    sleep $((try * 3))
  done
  if [ "$pushed" = 1 ]; then
    echo "lane: adoption items committed to main (or nothing to adopt)"
  else
    echo "lane: adoption items not pushed" >&2; echo x >>"$_SAFE_FAILS"
  fi
fi

safe_exit
