#!/usr/bin/env bash
# Pushes each Ultrastable bundle to its (already created, empty, private) repo under github.com/ultrastable.
set -euo pipefail
cd "$(dirname "$0")"
for b in site docs platform ip business seed dot-github; do
  repo=$b; [ "$b" = dot-github ] && repo=.github
  rm -rf "/tmp/us-$b"; git clone -q -b main "$b.bundle" "/tmp/us-$b"
  git -C "/tmp/us-$b" push "https://github.com/ultrastable/$repo.git" main:main
done
