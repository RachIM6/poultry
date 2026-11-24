# Database backup and restore

T26 asks for "a daily backup runs and has been restored once as a test". Everything lives in PostgreSQL, uploaded files
included (`StoredFile.bytes`, ADR-011), so one `pg_dump` is the whole backup.

| Script | What it does |
|---|---|
| `scripts/backup.sh` | `pg_dump -Fc` of `DATABASE_URL`, encrypted with gpg, written to `BACKUP_DIR` as `poultry-<UTC date and time>.dump.gpg`, then prunes old dumps |
| `scripts/restore.sh <file> <target-db-url> [--force]` | decrypts and `pg_restore`s into an existing database, in one transaction, then prints `prisma migrate status` |
| `scripts/backup-drill.sh` | the round trip, run by CI (`backup-drill` job) and locally |

## Decided defaults, to review

- **Encryption:** gpg symmetric, AES256, passphrase from `BACKUP_PASSPHRASE_FILE` (preferred) or `BACKUP_PASSPHRASE`. gpg is on every Linux host and in git-bash; `age` would be a new dependency. Without a passphrase the script refuses to run: no unencrypted dump is ever written.
- **Retention:** the newest dump of each of the last 7 days and of each of the last 4 ISO weeks, the current week included (restic's `--keep-daily 7 --keep-weekly 4`). Running daily, that is 9 or 10 files, the oldest 15 to 21 days old. Only `poultry-*.dump.gpg` files in `BACKUP_DIR` are ever deleted.
- **RPO: 24 hours** (one dump a day). Whatever was synced after the last dump is lost; what is still queued on a phone comes back with its next sync.
- **RTO:** the restore itself took **2 s** in the drill on 2026-11-24 (106 tables, 1,141 rows, a 1 MiB stored file; PostgreSQL 18.6 in Docker on a laptop) and the whole drill 56 s. The real RTO is dominated by getting a host, the app and the dump in place; it gets measured in the drill on the host (below).

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | backup, drill | the database to dump (drill: any database on the server where it may create databases) |
| `BACKUP_DIR` | backup | where the dumps go; created if missing |
| `BACKUP_PASSPHRASE_FILE` / `BACKUP_PASSPHRASE` | backup, restore | the passphrase, from a file (mode 600) or the variable itself. It is fed to gpg on a file descriptor, never on the command line |
| `PG_EXEC` | all three | optional prefix for `pg_dump`, `pg_restore` and `psql`, e.g. `docker exec -i poultry-db-1` when the host has no PostgreSQL client. The URL is then read from inside that container |

Requirements: bash, GNU `date`, gpg, and a PostgreSQL client whose major version is at least the server's (18):
`backup.sh` checks it and refuses otherwise. `restore.sh` also needs the repository with `pnpm install` done, for `prisma migrate status`.
The scripts print no URL and no passphrase; the restore only names the target database.

## Daily backup

Put the settings in a root-only file, e.g. `/etc/poultry/backup.env` (mode 600):

```sh
DATABASE_URL=postgresql://…
BACKUP_DIR=/var/backups/poultry
BACKUP_PASSPHRASE_FILE=/etc/poultry/backup.pass
```

and add the cron line (host time; 02:15 is a quiet hour for the farms):

```cron
15 2 * * * cd /srv/poultry && set -a && . /etc/poultry/backup.env && scripts/backup.sh >> /var/log/poultry-backup.log 2>&1
```

The script stops on the first error (`set -euo pipefail`) and exits non-zero; a half-written dump is removed, never
left under its final name. Copying the new file off the host comes after it (see "Needs owner").

## Restore

1. Create an empty database: `createdb -O <app user> poultry_restored` (or `create database …` in `psql`).
2. `BACKUP_PASSPHRASE_FILE=/etc/poultry/backup.pass scripts/restore.sh /var/backups/poultry/poultry-<…>.dump.gpg postgresql://…/poultry_restored`
3. Check the end of the output: `Database schema is up to date!`. The script fails otherwise.
4. Point the app's `DATABASE_URL` at the restored database (or rename it in place of the old one) and restart the app.

The restore refuses a target that already has tables in `public`. `--force` restores over it: the dump's objects are
dropped and recreated, tables that aren't in the dump stay. Roles and grants aren't restored (`--no-owner --no-acl`):
the connecting user owns everything, so the dump also restores on a host whose role names differ.

## Drill

CI runs it on every pull request and push to `main` (`backup-drill` job, PostgreSQL 18 client from the PGDG apt repository). Locally,
against the `db` service of `docker-compose.yml`, with the tools inside the container (no local client needed):

```sh
DATABASE_URL=postgresql://poultry:poultry@localhost:5432/poultry PG_EXEC="docker exec -i poultry-db-1" scripts/backup-drill.sh
```

It creates `poultry_bk_src` and `poultry_bk_dst` on that server and drops them at the end, whatever happens. In between:
`prisma migrate deploy`, `pnpm db:seed`, `pnpm db:seed:demo` and a 1 MiB `StoredFile` holding every byte value into
the source; `backup.sh` (after 40 days of old dumps were laid down to check the retention) and `restore.sh` into the
empty target; then it checks that every table's row count matches, that each restored `StoredFile.sha256` equals the
SHA-256 of its bytes, that `prisma migrate status` is clean, and that a backup without a passphrase and a restore over
a non-empty database are both refused. It ends with `drill: OK: …`.

## Needs owner

- **Off-site storage:** where the dumps are copied after each run (another provider or region than the database), and
  the tool that copies them. Until then a dump on the same host dies with it. Tied to hosting (OQ1).
- **Passphrase custody:** who holds the passphrase, where it is kept apart from the dumps (a password manager, a
  sealed paper copy), and who else can reach it. A lost passphrase makes every dump useless.
- **Failure alert:** cron is silent when the backup fails; something must watch the log or the exit code.
- **The real drill on the host:** restore the latest real dump into a scratch database on the pilot host, check the
  migrate status and a few counts, time it (that is the RTO), and record the date here. That ticks the T26 line.
