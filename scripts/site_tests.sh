#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# GATE-PARITY-1: the one test gate of the site deploy. deploy-site.yml, checks.yml and foundation/redmain.py (gate `deploy-site`) all run this file,
# so a change that would block the deploy is red on its pull request, and a red main is repaired against the same command.
set -u
for t in site/*.test.mjs; do
  node --no-warnings "$t" || { echo "site test failed: $t" >&2; exit 1; }
done
echo "site tests ok"
