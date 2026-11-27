#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# REGEN-1: regenerate every file a generator owns, so a PR is never red only because main moved a count, a ledger or the dashboard under it.
# Used by checks.yml before the freshness checks, and by any agent before it opens a PR. Each generator's failure is reported, never swallowed.
# REGEN-PARITY-1: every generator of scripts/regen_generated.py that is not post-merge-only is in this list (`regen_generated.py --pr-list`), because a
# pull request carries no generated file: a change to an essential variable, a tenant row or a config must find its generated file rebuilt here.
set -u
rc=0
for g in "python3 -m foundation publication --fix" "python3 -m foundation claims --fix --apply" "python3 scripts/build_dashboard.py" \
         "python3 scripts/build_site_roadmap.py" "python3 -m foundation doctrine --apply" "python3 -m foundation glossary --apply" \
         "python3 -m foundation standards --apply" "python3 scripts/build_site_agentdata.py" "python3 -m foundation configschema --gen" "python3 -m foundation stdgen --gen" "python3 -m foundation selfmodel --apply" "python3 -m foundation needsyou" "python3 -m foundation triggers --sync" \
         "python3 -m foundation research --page --apply" "python3 -m foundation trajectory --page" "python3 -m foundation verify --data --apply" \
         "python3 -m foundation ultrastability --data --apply" "python3 -m foundation admit --apply" "python3 -m foundation owndb --write" "python3 -m foundation tenantcontrols --write" \
         "python3 -m foundation upstream contract --apply" "env -C seed python3 -m plugins self --write" \
         "python3 seed/scripts/claims.py --apply --fix" "python3 seed/scripts/system.py --write" "python3 seed/scripts/surfaces.py --render --root ."; do  # KIT-REGEN-1: the kit's README counts and SYSTEM.md follow a change under seed/
   # REGEN-RESEARCH-1: the lane resolves site/research-data.js to main's side, so a PR that adds a study must get its papers rebuilt here
  if ! out=$($g 2>&1); then echo "::warning::REGEN-1 generator failed: $g: ${out: -300}"; rc=1; fi
done
git status --short
exit $rc
