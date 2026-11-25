#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# BG-13 + SLA-ISSUE-1: "done" means the public org page renders the profile. One idempotent pass: a passing probe closes its own open issue with the
# evidence (the weekly cron alone left issue 2033 open for days after the cause was gone); a failing probe files it once and exits 1.
# The phrase is the profile README's own headline (.github/profile/README.md); the old phrase "runs itself" is not in that text, so the probe could never pass.
# grep -q exits at its first match, so `echo "$page" | grep -q` dies of SIGPIPE under pipefail on a large page and a passing probe read as a failure; a here-string has no pipe.
set -uo pipefail
. "$(dirname "$0")/lib-safe.sh"
ORG="${ORG:-${GITHUB_REPOSITORY_OWNER:?}}"; repo="${GITHUB_REPOSITORY:?}"; PHRASE="${PROFILE_PHRASE:-foundation for any autonomous system}"
title="org-profile-probe: public org page missing profile"
# an exact title match over the open list: `--search "org-profile-probe: ... in:title"` reads the leading `org-profile-probe:` as a search qualifier and finds nothing,
# so a passing probe never found its issue to close and a failing one filed a duplicate each time
n=$(gh issue list --repo "$repo" --state open --limit 200 --json number,title --jq "[.[] | select(.title == \"$title\")] | .[0].number // empty")
if page=$(curl -fsSL --max-time 30 "https://github.com/$ORG") && grep -qi "$PHRASE" <<<"$page"; then
  echo "ok: profile live"
  [ -n "$n" ] && gh issue close "$n" --repo "$repo" --reason completed --comment "SLA-ISSUE-1: the org page shows the profile (\`$PHRASE\`) at $(date -u +%FT%TZ); closing probe passed."
  safe_exit; exit 0
fi
echo "::error::https://github.com/$ORG does not show the profile"
[ -n "$n" ] || gh issue create --repo "$repo" --title "$title" --body "Probe failed. Owner: org-init. Check .github is unarchived+public and profile/README.md exists. Closing probe: this workflow passes."
exit 1
