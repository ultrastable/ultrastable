#!/usr/bin/env bash
# REDMAIN-1 gate: main must meet the open-standards check (OPEN-STANDARDS-1). redmain runs this at HEAD and, when it is red, repairs it by code.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m foundation openstd --check
