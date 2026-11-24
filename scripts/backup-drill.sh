#!/usr/bin/env bash
# Backup round trip (docs/backup.md), run in CI and locally: migrate and seed a scratch database with the demo farm
# and a stored file, back it up with scripts/backup.sh, restore it with scripts/restore.sh into a fresh database,
# then compare every table's row count, every StoredFile's hash and `prisma migrate status`. Also checks the
# retention and the two refusals (no passphrase, non-empty target).
#
#   DATABASE_URL  any database on the server; the drill creates, then drops, poultry_bk_src and poultry_bk_dst there
#   PG_EXEC       as in backup.sh, e.g. "docker exec -i poultry-db-1" when there's no local PostgreSQL client
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?drill: DATABASE_URL is not set}"
admin=$DATABASE_URL
src=${admin%/*}/poultry_bk_src
dst=${admin%/*}/poultry_bk_dst
pg=(${PG_EXEC:-}) # split on purpose: a command prefix
sql() { "${pg[@]}" psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "$2"; }
fail() { echo "drill: FAIL: $*" >&2; exit 1; }

work=$(mktemp -d)
drop() { sql "$admin" "drop database if exists poultry_bk_src with (force)" && sql "$admin" "drop database if exists poultry_bk_dst with (force)"; }
trap 'drop; rm -rf "$work"' EXIT
drop
sql "$admin" "create database poultry_bk_src"
sql "$admin" "create database poultry_bk_dst"

echo "drill: seeding poultry_bk_src"
DATABASE_URL=$src pnpm exec prisma migrate deploy
DATABASE_URL=$src pnpm db:seed
DATABASE_URL=$src pnpm db:seed:demo
# 1 MiB holding every byte value, as an uploaded file would be stored (ADR-011).
sql "$src" "insert into \"StoredFile\" (id, \"organizationId\", purpose, \"contentType\", \"sizeBytes\", sha256, bytes, \"uploadedBy\")
  select gen_random_uuid(), o.id, 'document', 'application/pdf', length(f.b), encode(sha256(f.b), 'hex'), f.b, gen_random_uuid()
  from (select id from \"Organization\" limit 1) o,
       (select decode(repeat(string_agg(lpad(to_hex(i), 2, '0'), '' order by i), 4096), 'hex') b from generate_series(0, 255) i) f"

# Old dumps for the retention check: one a day for the 40 days before today.
for i in $(seq 1 40); do : >"$work/poultry-$(date -u -d "-$i day" +%Y-%m-%d)T000000Z.dump.gpg"; done

export BACKUP_PASSPHRASE="drill-only-$RANDOM$RANDOM$RANDOM" BACKUP_DIR=$work
if BACKUP_PASSPHRASE="" DATABASE_URL=$src bash scripts/backup.sh 2>/dev/null; then fail "backup ran without a passphrase"; fi
DATABASE_URL=$src bash scripts/backup.sh

# Today's 7 dailies (today and the 6 days before), plus the newest dump of each of the 3 previous ISO weeks that the
# dailies don't already cover: 2 of them, or 3 on a Sunday (then the dailies are exactly this week).
kept=$(find "$work" -name 'poultry-*.dump.gpg' | wc -l)
expected=$(($(date -u +%u) == 7 ? 10 : 9))
[ "$kept" -eq "$expected" ] || fail "retention kept $kept dumps, expected $expected"

file=$(ls "$work"/poultry-*.dump.gpg | sort | tail -1)
bash scripts/restore.sh "$file" "$dst" | tee "$work/restore.log"
grep -q "Database schema is up to date" "$work/restore.log" || fail "prisma migrate status is not clean on the restored database"
if bash scripts/restore.sh "$file" "$dst" 2>/dev/null; then fail "restore overwrote a non-empty database without --force"; fi

counts="select table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"
sql "$src" "$counts" >"$work/src.counts"
sql "$dst" "$counts" >"$work/dst.counts"
diff "$work/src.counts" "$work/dst.counts" || fail "row counts differ (source < >, restored)"

n=$(sql "$dst" 'select count(*) from "StoredFile"')
bad=$(sql "$dst" "select count(*) from \"StoredFile\" where sha256 <> encode(sha256(bytes), 'hex')")
[ "$n" -gt 0 ] || fail "no StoredFile row restored"
[ "$bad" = 0 ] || fail "$bad restored StoredFile rows don't match their sha256"

rows=$(awk '{ n += $2 } END { print n }' "$work/dst.counts")
echo "drill: OK: $(wc -l <"$work/dst.counts") tables and $rows rows match, $n StoredFile hashes check out, migrations clean"
