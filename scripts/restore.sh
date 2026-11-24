#!/usr/bin/env bash
# Restore a dump made by scripts/backup.sh (docs/backup.md).
#
#   scripts/restore.sh <file> <target-db-url> [--force]
#
# Same passphrase variables and PG_EXEC as backup.sh. The target database must already exist. It must have no table
# in the public schema, unless --force is given: then the dump's objects are dropped and recreated in place (tables
# that aren't in the dump stay). The restore is one transaction: on any error nothing is kept. Then prints
# `prisma migrate status` for the target (needs the repository and `pnpm install`) and fails if it isn't clean.
set -euo pipefail
umask 077

usage="usage: scripts/restore.sh <file> <target-db-url> [--force]"
file=${1:?$usage}
target=${2:?$usage}
force=${3:-}
[ -z "$force" ] || [ "$force" = --force ] || { echo "$usage" >&2; exit 1; }
[ -r "$file" ] || { echo "restore: cannot read $file" >&2; exit 1; }
db=${target##*/}
db=${db%%\?*} # the database name only: the URL carries the password

if [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  [ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "restore: BACKUP_PASSPHRASE_FILE is missing or empty" >&2; exit 1; }
  pass=(--passphrase-file "$BACKUP_PASSPHRASE_FILE")
elif [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  pass=(--passphrase-fd 3)
else
  echo "restore: no passphrase (set BACKUP_PASSPHRASE_FILE or BACKUP_PASSPHRASE)" >&2
  exit 1
fi

pg=(${PG_EXEC:-}) # split on purpose: a command prefix

tables=$("${pg[@]}" psql "$target" -XAtqc "select count(*) from pg_tables where schemaname = 'public'")
clean=()
if [ "$tables" != 0 ]; then
  if [ "$force" != --force ]; then
    echo "restore: $db already has $tables tables in public; refusing (pass --force to overwrite them)" >&2
    exit 1
  fi
  clean=(--clean --if-exists)
fi

start=$SECONDS
gpg --batch --quiet --pinentry-mode loopback --no-symkey-cache "${pass[@]}" --decrypt "$file" 3<<<"${BACKUP_PASSPHRASE:-}" |
  "${pg[@]}" pg_restore --no-owner --no-acl --single-transaction "${clean[@]}" -d "$target"
echo "restore: $file restored into $db in $((SECONDS - start)) s"

cd "$(dirname "$0")/.."
DATABASE_URL=$target pnpm exec prisma migrate status
