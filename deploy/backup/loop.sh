#!/bin/sh
# Every night at BACKUP_HOUR: an encrypted backup outside the server. Every week (RESTORE_TEST_WEEKDAY, 0 = Sunday):
# a real restore of the latest backup into a temporary database, checked, then dropped.
set -u
HOUR="${BACKUP_HOUR:-3}"; WD="${RESTORE_TEST_WEEKDAY:-0}"
restic snapshots >/dev/null 2>&1 || restic init || echo "restic init failed: check RESTIC_REPOSITORY and credentials"
last=""
while true; do
  now_h=$(date +%H | sed 's/^0//'); today=$(date +%F)
  if [ "${now_h:-0}" -eq "$HOUR" ] && [ "$last" != "$today" ]; then
    last="$today"
    backup.sh || true
    [ "$(date +%w)" = "$WD" ] && { restore-test.sh || true; }
  fi
  sleep 300
done
