#!/usr/bin/env bash
# Creates labels, milestones, issues and org Projects for Ultrastable from docs/issues/*.json.
# Run after the six repos exist and docs has been pushed. Needs: gh (signed in, scopes repo + project), jq.
set -euo pipefail
ORG=ultrastable; REPO=$ORG/docs
dir="${1:-$(mktemp -d)}"
[ -d "$dir/docs/issues" ] || { git clone -q "$(dirname "$0")/docs.bundle" "$dir/docs"; }
cd "$dir/docs" 2>/dev/null || cd "$dir"
for l in $(jq -r '.[]' issues/_labels.json); do gh label create "$l" -R $REPO --force >/dev/null; done
for m in Now Next "After filing" Later; do
  gh api repos/$REPO/milestones -f title="$m" >/dev/null 2>&1 || true
done
for p in "Portfolio: Ultrastable launch" Patent "GitHub org and web" "Funding and business" Platform; do
  gh project create --owner $ORG --title "$p" >/dev/null 2>&1 || true
done
for f in issues/[A-Z]*.json; do
  t=$(jq -r .title $f)
  gh issue list -R $REPO --search "\"$t\" in:title" --state all --json title -q '.[].title' | grep -qxF "$t" && continue
  args=(); for l in $(jq -r '.labels[]' $f); do args+=(--label "$l"); done
  gh issue create -R $REPO --title "$t" --body "$(jq -r .body $f)" --milestone "$(jq -r .milestone $f)" "${args[@]}"
done
echo "Done. Add issues to Projects with: gh project item-add <n> --owner $ORG --url <issue-url>"
