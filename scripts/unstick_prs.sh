#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# UNSTICK-1: an open PR in conflict with main is reconciled, not left open. For each same-repository PR GitHub reports as not mergeable:
# merge main in, resolve generated and append-only files (scripts/resolve_generated.py), set generated files to main's copy, push, and
# dispatch checks. A PR whose conflict is in hand-written code is reported as a warning with its files (never silently skipped) and left for its author.
set -u
repo="${GITHUB_REPOSITORY:-ultrastable/ultrastable}"
git config user.name "ultrastable-unstick"; git config user.email "actions@users.noreply.github.com"
git fetch -q origin main
for n in $(gh api "repos/$repo/pulls?state=open&per_page=50" --jq '.[]|select(.head.repo.full_name=="'"$repo"'")|.number'); do
  m=$(gh api "repos/$repo/pulls/$n" --jq '.mergeable')
  [ "$m" = "false" ] || continue
  ref=$(gh api "repos/$repo/pulls/$n" --jq '.head.ref')
  echo "PR #$n ($ref) conflicts with main: reconciling"
  # UNSTICK-CLEAN-1: a PR left half-reconciled (resolve_generated wrote README.md, then the merge was aborted) made every later PR fail with
  # "Entry 'README.md' not uptodate. Cannot merge." (ciwatch run 44968652106). Each PR starts from a clean tree.
  git merge --abort >/dev/null 2>&1 || echo "no merge in progress"; git reset -q --hard; git clean -fdq
  git fetch -q origin "$ref" && git checkout -q -B unstick FETCH_HEAD || { echo "::warning::UNSTICK-1 #$n: cannot fetch $ref"; continue; }
  if ! git merge -q --no-edit origin/main >/dev/null 2>&1; then
    if ! python3 scripts/resolve_generated.py; then
      echo "::warning::UNSTICK-1 #$n: code conflict in $(git diff --name-only --diff-filter=U | tr '\n' ' ')"; git merge --abort; continue
    fi
    git commit -q --no-edit
  fi
  # MERGE-NOW-1: generated files follow main and are regenerated on main after the merge (REGEN-GENERATED-1). Regenerating them into the PR here made the
  # PR diverge from main on those files again, so it conflicted on the next bot commit to main (seen on #935, 2026-11-21).
  for g in $(node -e "import('./seed/worker/src/generated.js').then(m=>console.log(m.GENERATED.join('\n')))"); do
    if [ -n "$(git ls-tree origin/main -- "$g")" ]; then git checkout -q origin/main -- "$g"; fi  # a file main does not have is left as the PR has it
  done
  git add -A; git diff --cached --quiet || git commit -q -m "unstick: generated files follow main (UNSTICK-1)"
  if git push -q origin "HEAD:refs/heads/$ref"; then
    echo "PR #$n reconciled"; gh workflow run checks.yml --ref "$ref" || echo "::warning::UNSTICK-1 #$n: checks dispatch failed"
  else
    echo "::warning::UNSTICK-1 #$n: push to $ref refused"
  fi
done
git checkout -q --detach origin/main
