#!/usr/bin/env sh
# Local host: cron or systemd timer calls this. Example crontab line: 17 * * * * /path/to/ultrastable/deploy/loops/local/run-loop.sh
set -eu
cd "$(dirname "$0")/../../.."
ULTRASTABLE_HOST="${ULTRASTABLE_HOST:-local-cron}" python3 -m foundation launch --failover --commit --push
