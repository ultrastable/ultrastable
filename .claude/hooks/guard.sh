#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# PreToolUse guard (kernel 9.2.0 R4/F3/GATE). Exit 2 blocks; exit 1 does not. A tripwire, not a security boundary:
# the boundary is branch protection, CODEOWNERS and the merge identity the executor never holds.
set -uo pipefail
in=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$in")
path=$(jq -r '.tool_input.file_path // ""' <<<"$in"); rel=${path#"${CLAUDE_PROJECT_DIR:-}/"}
cmd=$(jq -r '.tool_input.command // ""' <<<"$in")
P='(doctrine/(step-repertoire|partitions|kernel9)\.json|doctrine/kernel-9\.0\.0\.md|seed/autonomy/|\.github/workflows/|\.claude/|tests/holdout/|actions-budget\.json|ops/halt\.json)'
if [[ -n "$rel" && "$rel" =~ ^$P ]]; then
  echo "BLOCKED R4: $rel is owner-owned. Record disposition=flagged describing the change needed, or carry a Protected-change line if the task is about it." >&2; exit 2; fi
if [[ "$tool" == "Bash" ]] && grep -Eq -- "--no-verify|push .*(-f|--force)|reset --hard|(rm|mv|sed -i|tee)[^|;]*$P" <<<"$cmd"; then
  echo "BLOCKED R4/G1: command touches a gate or protected path. Use a branch and PR, or disposition=flagged." >&2; exit 2; fi
exit 0
