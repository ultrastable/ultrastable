#!/usr/bin/env bash
# Build the versioned private artifacts qnfo-workers consumes (QNFO-REFACTOR-PLAN step 3 mechanism).
# Usage: ./build-artifacts.sh <version>   -> dist/{core-sql,scripts}-<ver>.tar, guard-<ver>.js, SHA256SUMS
# Publish dist/ to a PRIVATE release or R2 bucket only. Never print file contents in CI logs.
set -euo pipefail
v="${1:?version}"; cd "$(dirname "$0")"; mkdir -p dist
tar -cf "dist/core-sql-$v.tar" migrations
tar -cf "dist/scripts-$v.tar" --exclude=__pycache__ scripts
cp qnfo-deploy-guard/worker.js "dist/guard-$v.js"
(cd dist && sha256sum ./*"$v"* > SHA256SUMS)
echo "built $v; pin these hashes in the public stub (hashes disclose nothing):"; cat dist/SHA256SUMS
