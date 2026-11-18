#!/usr/bin/env bash
# Apply github/org-settings.json to GitHub. Idempotent. Needs gh + jq and a token with org admin
# (ORG_ADMIN_TOKEN, docs/ops/ORG-TOKEN.md). No call is silenced: each failure is printed, counted,
# and the script exits 1 so the run is red and the gap stays open.
# usage: apply_github_settings.sh [apply|probe]
set -uo pipefail
MODE="${1:-apply}"
CFG="${CFG:-github/org-settings.json}"
ORG="${ORG:-ultrastable}"
fail=0; gated=0
# Fail closed on missing tools: a missing jq used to make every step a silent no-op that still printed "failures: 0".
command -v jq >/dev/null 2>&1 || { echo "FAIL jq is required (apt install jq / winget install jqlang.jq)"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "FAIL gh is required"; exit 1; }
jq() { command jq "$@" | tr -d '\r'; }
# PLAN-GATED: features GitHub withholds from private repos on the Free plan (HTTP 403/422 with these messages) are reported as GATED, counted
# separately and listed in docs/BOOTSTRAP-GAPS.md; any other failure stays red.
step() { local label="$1"; shift; if out=$("$@" 2>&1); then echo "ok   $label"
  elif grep -qE "Upgrade to GitHub (Pro|Team)|not available for this repository|make this repository public" <<<"$out"; then echo "GATED $label: plan feature (needs paid plan or public repo)"; gated=$((gated+1))
  else echo "FAIL $label: $out"; fail=$((fail+1)); fi; }

if [ "$MODE" = probe ]; then
  gh api "orgs/$ORG" --jq '{login,description,blog,email,default_repository_permission,members_can_create_public_repositories}' || fail=$((fail+1))
  for R in $(jq -r '.repos|keys[]' "$CFG"); do
    gh api "repos/$R" --jq '{full_name,description,homepage,topics,has_wiki,delete_branch_on_merge,allow_squash_merge,allow_merge_commit,security_and_analysis}' || fail=$((fail+1))
  done
  [ "$fail" -eq 0 ]; exit
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
  if [ "$(gh api "repos/$R" --jq .archived 2>/dev/null)" = true ]; then echo "skip $R (archived)"; continue; fi
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
  # DIRECT-MERGE-GATE-1: rulesets are upserted by name, so a re-run changes nothing
  n=$(jq -r ".repos[\"$R\"].rulesets // [] | length" "$CFG")
  for i in $(seq 0 $((n-1))); do
    rs=$(jq -c ".repos[\"$R\"].rulesets[$i] | del(._doc)" "$CFG"); name=$(jq -r .name <<<"$rs")
    id=$(gh api "repos/$R/rulesets" --jq ".[]|select(.name==\"$name\")|.id" 2>&1) || { echo "FAIL repo $R ruleset $name: $id"; fail=$((fail+1)); continue; }
    if [ -n "$id" ]; then step "repo $R ruleset $name (update)" gh api -X PUT "repos/$R/rulesets/$id" --input - <<<"$rs"
    else step "repo $R ruleset $name (create)" gh api -X POST "repos/$R/rulesets" --input - <<<"$rs"; fi
  done
done
echo "failures: $fail gated: $gated"
[ "$fail" -eq 0 ]
