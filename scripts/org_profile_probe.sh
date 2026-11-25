#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# BG-13 + SLA-ISSUE-1: "done" means the public org page renders the profile. One idempotent pass: a passing probe closes its own open issue with the
# evidence (the weekly cron alone left issue 2033 open for days after the cause was gone); a failing probe files it once and exits 1.
# The phrase is the profile README's own headline (.github/profile/README.md); the old phrase "runs itself" is not in that text, so the probe could never pass.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
ORG="${ORG:-${GITHUB_REPOSITORY_OWNER:?}}"; repo="${GITHUB_REPOSITORY:?}"; PHRASE="${PROFILE_PHRASE:-foundation for any autonomous system}"
title="org-profile-probe: public org page missing profile"
n=$(gh issue list --repo "$repo" --state open --search "$title in:title" --json number --jq '.[0].number // empty')
if page=$(curl -fsSL --max-time 30 "https://github.com/$ORG") && echo "$page" | grep -qi "$PHRASE"; then
  echo "ok: profile live"
  [ -n "$n" ] && gh issue close "$n" --repo "$repo" --reason completed --comment "SLA-ISSUE-1: the org page shows the profile (\`$PHRASE\`) at $(date -u +%FT%TZ); closing probe passed."
  safe_exit; exit 0
fi
echo "::error::https://github.com/$ORG does not show the profile"
[ -n "$n" ] || gh issue create --repo "$repo" --title "$title" --body "Probe failed. Owner: org-init. Check .github is unarchived+public and profile/README.md exists. Closing probe: this workflow passes."
exit 1
