#!/usr/bin/env bash
# ULTRASTABLE-1 gate: every ops script that calls gh must be bounded and counted.
# Rules (per scripts/*.sh except lib-safe.sh): strict mode set; if it calls gh, it sources
# lib-safe.sh and ends with safe_exit. Exits 1 listing every violation.
set -uo pipefail
cd "$(dirname "$0")"
bad=0
for f in *.sh; do
  [ "$f" = lib-safe.sh ] && continue; [ "$f" = check_ultrastable.sh ] && continue
  grep -Eq '^set -[a-z]*u' "$f" || { echo "FAIL $f: no strict mode (set -u...)"; bad=$((bad+1)); }
  if grep -Eq '(^|[^A-Za-z_.-])gh ' "$f"; then
    grep -q 'lib-safe.sh' "$f" || { echo "FAIL $f: calls gh without lib-safe.sh"; bad=$((bad+1)); }
    tail -n 3 "$f" | grep -q '^safe_exit$' || { echo "FAIL $f: must end with safe_exit"; bad=$((bad+1)); }
  fi
done
[ "$bad" -eq 0 ] && echo "ultrastable gate: ok" || { echo "ultrastable gate: $bad violation(s)"; exit 1; }
