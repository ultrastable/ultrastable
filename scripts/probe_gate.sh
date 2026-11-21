#!/usr/bin/env bash
# PROBE-FORMAT-1 gate for REDMAIN-1: red when any write-back or ledger probe is malformed or points at nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m foundation writeback check
