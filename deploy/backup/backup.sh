#!/bin/sh
# Database dump (custom format, every table, the quote PDFs included), encrypted by restic and sent off the server.
set -eu
STATUS="${STATUS_FILE:-/backup-status/status.json}"; mkdir -p "$(dirname "$STATUS")"; [ -f "$STATUS" ] || echo '{}' > "$STATUS"
put(){ tmp="$STATUS.tmp"; jq "$1" "$STATUS" > "$tmp" && mv "$tmp" "$STATUS"; }
repo_shown=$(printf '%s' "$RESTIC_REPOSITORY" | sed -E 's#(//)?[^@/:]+@#\1***@#')
now=$(date -u +%FT%TZ)
if pg_dump --format=custom --no-owner --no-privileges --compress=0 | restic backup --stdin --stdin-filename warsha.dump --tag db --host warsha-atelier --quiet; then
  restic forget --tag db --keep-daily 14 --keep-weekly 8 --keep-monthly 24 --prune --quiet || true
  n=$(restic snapshots --tag db --json | jq length)
  put ".lastBackupAt=\"$now\" | .lastBackupOk=true | .repository=\"$repo_shown\" | .snapshots=$n | .lastError=null"
  echo "backup ok $now ($n snapshots)"
else
  put ".lastBackupAt=\"$now\" | .lastBackupOk=false | .repository=\"$repo_shown\" | .lastError=\"backup failed\""
  echo "backup FAILED $now" >&2; exit 1
fi
