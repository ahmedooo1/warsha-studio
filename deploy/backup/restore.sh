#!/bin/sh
# Full restore of the live database from a backup (after a disk loss, or to move to a new server).
#   docker compose -f deploy/docker-compose.yml stop app
#   docker compose -f deploy/docker-compose.yml run --rm backup restore.sh [snapshot-id|latest]
#   docker compose -f deploy/docker-compose.yml start app
# It asks for confirmation: everything in the live database is replaced by the backup.
set -eu
SNAP="${1:-latest}"
restic snapshots --tag db
printf 'Replace the live database "%s" with backup %s? Type RESTORE: ' "$PGDATABASE" "$SNAP"; read -r ok
[ "$ok" = "RESTORE" ] || { echo "cancelled"; exit 1; }
work=$(mktemp -d); restic dump --tag db "$SNAP" warsha.dump > "$work/warsha.dump"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGDATABASE" "$work/warsha.dump"
rm -rf "$work"; echo "restored $SNAP into $PGDATABASE"
