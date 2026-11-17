#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# UNSTICK-1: an open PR in conflict with main is reconciled, not left open. For each same-repository PR GitHub reports as not mergeable:
# merge main in, resolve generated and append-only files (scripts/resolve_generated.py), regenerate (scripts/regen_generated.sh), push, and
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
  git fetch -q origin "$ref" && git checkout -q -B unstick FETCH_HEAD || { echo "::warning::UNSTICK-1 #$n: cannot fetch $ref"; continue; }
  if ! git merge -q --no-edit origin/main >/dev/null 2>&1; then
    if ! python3 scripts/resolve_generated.py; then
      echo "::warning::UNSTICK-1 #$n: code conflict in $(git diff --name-only --diff-filter=U | tr '\n' ' ')"; git merge --abort; continue
    fi
    git commit -q --no-edit
  fi
  ./scripts/regen_generated.sh >/dev/null || echo "::warning::UNSTICK-1 #$n: a generator failed"
  git add -A; git diff --cached --quiet || git commit -q -m "UNSTICK-1: regenerate after merging main"
  if git push -q origin "HEAD:refs/heads/$ref"; then
    echo "PR #$n reconciled"; gh workflow run checks.yml --ref "$ref" || echo "::warning::UNSTICK-1 #$n: checks dispatch failed"
  else
    echo "::warning::UNSTICK-1 #$n: push to $ref refused"
  fi
done
git checkout -q --detach origin/main
