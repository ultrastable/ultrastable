# ULTRASTABLE-1: bounded, counted gh calls. Source after `set -uo pipefail`.
# Every gh call gets a timeout; failures/timeouts are logged to stderr and counted in a
# file (survives pipe subshells). Call `safe_exit` last: exits 1 if any call failed, so a
# degraded run is red, never silently green. Env: GH_TIMEOUT (default 60s).
_GH_BIN="$(command -v gh)"; _SAFE_FAILS="$(mktemp)"; trap 'rm -f "$_SAFE_FAILS"' EXIT
gh() {
  local rc=0
  timeout "${GH_TIMEOUT:-60}" "$_GH_BIN" "$@" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "safe-gh: rc=$rc (124=timeout): gh $*" >&2
    echo x >>"$_SAFE_FAILS"
  fi
  return "$rc"
}
safe_exit() {
  local n; n=$(wc -l <"$_SAFE_FAILS" | tr -d ' ')
  [ "$n" -eq 0 ] || { echo "safe-gh: $n gh call(s) failed" >&2; exit 1; }
}
