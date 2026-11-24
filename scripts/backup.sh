#!/usr/bin/env bash
# Encrypted database backup, run daily by cron (docs/backup.md).
#
#   DATABASE_URL            the database to dump
#   BACKUP_DIR              where the encrypted dumps go (created if missing)
#   BACKUP_PASSPHRASE_FILE  file holding the passphrase (preferred), or BACKUP_PASSPHRASE with the passphrase itself
#   PG_EXEC                 optional prefix for the PostgreSQL tools, e.g. "docker exec -i poultry-db-1"
#
# Writes BACKUP_DIR/poultry-<UTC date and time>.dump.gpg (pg_dump -Fc, gpg symmetric AES256), then keeps the newest
# dump of each of the last 7 days and of each of the last 4 ISO weeks (restic's --keep-daily 7 --keep-weekly 4) and
# deletes the other poultry-*.dump.gpg files. Needs bash, GNU date and gpg. Prints no URL and no passphrase.
set -euo pipefail
umask 077

: "${DATABASE_URL:?backup: DATABASE_URL is not set}"
: "${BACKUP_DIR:?backup: BACKUP_DIR is not set}"

if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  [ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "backup: BACKUP_PASSPHRASE_FILE is missing or empty" >&2; exit 1; }
  pass=(--passphrase-file "$BACKUP_PASSPHRASE_FILE")
elif [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  pass=(--passphrase-fd 3) # fed below with 3<<<, so the passphrase never shows in the process list
else
  echo "backup: no passphrase (set BACKUP_PASSPHRASE_FILE or BACKUP_PASSPHRASE); refusing to write an unencrypted dump" >&2
  exit 1
fi

pg=(${PG_EXEC:-}) # split on purpose: a command prefix

# pg_dump can't dump a newer server.
client=$("${pg[@]}" pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
server=$("${pg[@]}" psql "$DATABASE_URL" -XAtqc 'show server_version_num')
server=$((server / 10000))
if [ "$client" -lt "$server" ]; then
  echo "backup: pg_dump $client is older than the server ($server); install the PostgreSQL $server client" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
name="poultry-$(date -u +%Y-%m-%dT%H%M%SZ).dump.gpg"
tmp="$BACKUP_DIR/.$name.partial"
trap 'rm -f "$tmp"' EXIT
"${pg[@]}" pg_dump -Fc -d "$DATABASE_URL" |
  gpg --batch --yes --quiet --pinentry-mode loopback --no-symkey-cache "${pass[@]}" \
    --symmetric --cipher-algo AES256 --output "$tmp" 3<<<"${BACKUP_PASSPHRASE:-}"
mv "$tmp" "$BACKUP_DIR/$name"
echo "backup: wrote $BACKUP_DIR/$name ($(wc -c <"$BACKUP_DIR/$name") bytes)"

# Retention. Names sort by time, so newest first; the first file seen for a day (or week) is its newest.
days=0 weeks=0 last_day="" last_week=""
for f in $(cd "$BACKUP_DIR" && printf '%s\n' poultry-*.dump.gpg | sort -r); do
  day=${f:8:10}
  week=$(date -u -d "$day" +%G-%V)
  keep=""
  if [ "$day" != "$last_day" ] && [ "$days" -lt 7 ]; then days=$((days + 1)) keep=1; fi
  if [ "$week" != "$last_week" ] && [ "$weeks" -lt 4 ]; then weeks=$((weeks + 1)) keep=1; fi
  last_day=$day last_week=$week
  if [ -z "$keep" ]; then
    rm -f "$BACKUP_DIR/$f"
    echo "backup: pruned $f"
  fi
done
