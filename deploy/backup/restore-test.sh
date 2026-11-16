#!/bin/sh
# Restores the latest backup into a temporary database and checks it: tables present, rows counted, every quote PDF
# still matching its SHA-256. The temporary database is dropped after. The live database is never touched.
set -eu
STATUS="${STATUS_FILE:-/backup-status/status.json}"; [ -f "$STATUS" ] || echo '{}' > "$STATUS"
put(){ tmp="$STATUS.tmp"; jq "$1" "$STATUS" > "$tmp" && mv "$tmp" "$STATUS"; }
T=warsha_restore_test; now=$(date -u +%FT%TZ); work=$(mktemp -d)
fail(){ put ".lastRestoreTestAt=\"$now\" | .lastRestoreTestOk=false | .restoreTestDetail=\"$1\""; dropdb --if-exists "$T" || true; rm -rf "$work"; echo "restore test FAILED: $1" >&2; exit 1; }
restic dump --tag db latest warsha.dump > "$work/warsha.dump" || fail "cannot read the latest backup"
dropdb --if-exists "$T"; createdb "$T" || fail "cannot create the test database"
pg_restore --no-owner --no-privileges -d "$T" "$work/warsha.dump" || fail "pg_restore failed"
q(){ psql -d "$T" -Atc "$1"; }
p=$(q "SELECT count(*) FROM projects") || fail "no projects table"
qn=$(q "SELECT count(*) FROM quotes") || fail "no quotes table"
bad=$(q "SELECT count(*) FROM quotes WHERE pdf IS NOT NULL AND encode(sha256(pdf), 'hex') <> pdf_sha256")
live_p=$(psql -Atc "SELECT count(*) FROM projects"); live_q=$(psql -Atc "SELECT count(*) FROM quotes")
dropdb "$T"; rm -rf "$work"
[ "$bad" = "0" ] || fail "$bad quote PDFs do not match their fingerprint"
detail="$p projects, $qn quotes (live: $live_p, $live_q), all PDFs match"
put ".lastRestoreTestAt=\"$now\" | .lastRestoreTestOk=true | .restoreTestDetail=\"$detail\""
echo "restore test ok: $detail"
