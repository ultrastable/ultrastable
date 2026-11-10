#!/usr/bin/env bash
# Apply github/org-settings.json to GitHub. Idempotent. Needs gh + jq and a token with org admin
# (ORG_ADMIN_TOKEN, docs/ops/ORG-TOKEN.md). No call is silenced: each failure is printed, counted,
# and the script exits 1 so the run is red and the gap stays open.
# usage: apply_github_settings.sh [apply|probe]
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
MODE="${1:-apply}"
CFG="${CFG:-github/org-settings.json}"
ORG="${ORG:-ultrastable}"
fail=0
step() { local label="$1"; shift; if out=$("$@" 2>&1); then echo "ok   $label"; else echo "FAIL $label: $out"; fail=$((fail+1)); fi; }

if [ "$MODE" = probe ]; then
  gh api "orgs/$ORG" --jq '{login,description,blog,email,default_repository_permission,members_can_create_public_repositories}' || fail=$((fail+1))
  for R in $(jq -r '.repos|keys[]' "$CFG"); do
    gh api "repos/$R" --jq '{full_name,description,homepage,topics,has_wiki,delete_branch_on_merge,allow_squash_merge,allow_merge_commit,security_and_analysis}' || fail=$((fail+1))
  done
  safe_exit; [ "$fail" -eq 0 ]; exit
fi

# Org
args=()
for k in $(jq -r '.org|keys[]' "$CFG"); do
  v=$(jq -c ".org.$k" "$CFG")
  case "$v" in true|false) args+=(-F "$k=$v");; *) args+=(-f "$k=$(jq -r ".org.$k" "$CFG")");; esac
done
step "org $ORG" gh api -X PATCH "orgs/$ORG" "${args[@]}"

# Repos
for R in $(jq -r '.repos|keys[]' "$CFG"); do
  body=$(jq -c --argjson r "$(jq ".repos[\"$R\"]" "$CFG")" -n '$r.settings + {description:$r.description, homepage:$r.homepage}')
  step "repo $R settings" gh api -X PATCH "repos/$R" --input - <<<"$body"
  topics=$(jq -c '{names: .repos["'"$R"'"].topics}' "$CFG")
  step "repo $R topics" gh api -X PUT "repos/$R/topics" --input - <<<"$topics"
  [ "$(jq -r ".repos[\"$R\"].security.vulnerability_alerts" "$CFG")" = true ] && step "repo $R dependabot alerts" gh api -X PUT "repos/$R/vulnerability-alerts"
  [ "$(jq -r ".repos[\"$R\"].security.automated_security_fixes" "$CFG")" = true ] && step "repo $R dependabot fixes" gh api -X PUT "repos/$R/automated-security-fixes"
  sec=$(jq -c '{security_and_analysis:{secret_scanning:{status:.repos["'"$R"'"].security.secret_scanning},secret_scanning_push_protection:{status:.repos["'"$R"'"].security.secret_scanning_push_protection}}}' "$CFG")
  step "repo $R secret scanning" gh api -X PATCH "repos/$R" --input - <<<"$sec"
  br=$(jq -r ".repos[\"$R\"].branch_protection.branch" "$CFG")
  prot=$(jq -c '.repos["'"$R"'"].branch_protection | {required_status_checks:null,enforce_admins:false,required_pull_request_reviews:null,restrictions:null,allow_force_pushes,allow_deletions,required_linear_history}' "$CFG")
  step "repo $R protect $br" gh api -X PUT "repos/$R/branches/$br/protection" --input - <<<"$prot"
done
echo "failures: $fail"
[ "$fail" -eq 0 ] || exit 1
safe_exit
