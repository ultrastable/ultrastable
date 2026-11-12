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
# QUEUE-1: work items are repository data (docs/issues/*.json), so GitHub Issues are off on the code repository. A script that needs Issues calls
# `issues_or_exit` right after sourcing: it exits 0 with a note when Issues are off, instead of failing every run.
issues_or_exit() {
  local on; on=$(timeout 30 "$_GH_BIN" api "repos/${GITHUB_REPOSITORY:?}" --jq .has_issues 2>/dev/null || echo true)
  [ "$on" = false ] && { echo "issues are off on ${GITHUB_REPOSITORY}; work items live in docs/issues (QUEUE-1)"; exit 0; }
  return 0
}
