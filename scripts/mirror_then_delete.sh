#!/usr/bin/env bash
# FRONT-DOOR-2: mirror the six archived duplicate repos, verify each bundle, then (only with --delete) delete them. Deletion is irreversible and is an OWNER step.
# usage: scripts/mirror_then_delete.sh [--delete] [--dest DIR]     default is a dry run: mirror + verify only.
set -euo pipefail
ORG=ultrastable; REPOS="seed platform docs site business ip"; DEST="${DEST:-mirrors-$(date +%Y%m%d)}"; DELETE=0
while [ $# -gt 0 ]; do case "$1" in --delete) DELETE=1;; --dest) DEST="$2"; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; shift; done
mkdir -p "$DEST"
for r in $REPOS; do
  b="$DEST/$r.git"; [ -d "$b" ] || git clone --mirror -q "https://github.com/$ORG/$r.git" "$b"
  git -C "$b" bundle create "$DEST/$r.bundle" --all >/dev/null 2>&1
  git bundle verify "$DEST/$r.bundle" >/dev/null 2>&1 || { echo "FAIL: bundle for $r does not verify; nothing deleted" >&2; exit 1; }
  rt="$(mktemp -d)"; git clone -q "$DEST/$r.bundle" "$rt/x" 2>/dev/null || { echo "FAIL: bundle for $r does not restore" >&2; exit 1; }; rm -rf "$rt"
  echo "ok  $r  $(git -C "$b" rev-parse --short HEAD 2>/dev/null || echo ?)  restorable"
done
[ "$DELETE" = 1 ] || { echo "dry run: all bundles verified and restorable; re-run with --delete to delete (owner step)"; exit 0; }
for r in $REPOS; do gh repo delete "$ORG/$r" --yes; echo "deleted $ORG/$r"; done
gh repo list "$ORG" --limit 50 --json name -q '.[].name'
