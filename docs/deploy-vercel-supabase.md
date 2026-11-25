# Deploying on Vercel with Supabase (client demo)

The product owner's decision of 2026-11-24: the client demo runs on **Vercel** (the app) with **Supabase** (PostgreSQL).
The Docker path (`docs/deploy.md`) stays for a later production host. This page is the step-by-step for the owner.

> **Synthetic data only.** Vercel and Supabase host the data outside Morocco. Until the CNDP steps and the hosting ADR
> (ADR-007) are done, the demo holds demo farms only (`pnpm db:seed:demo`), never a real farm's names, phones or pay.

What the code already does for this setup (each point is a decided default, to review, at the end):

| Concern | Where |
|---|---|
| Runtime through Supabase's transaction pooler (port 6543), migrations through the session pooler (`DIRECT_URL`) | `src/lib/db.ts`, `prisma.config.ts` |
| TLS to Supabase verified against its CA (`DATABASE_CA_CERT`) | `src/lib/db.ts` |
| Every table under row level security, so Supabase's Data API can't serve them | migration `20261127000000_row_level_security`, checked by `src/lib/db.int.test.ts` |
| `uuidv7()` for a database older than PostgreSQL 18 | `prisma/uuidv7-before-pg18.sql` |
| Uploads capped at 4 MiB (Vercel Functions take request bodies up to 4.5 MB) | `src/modules/documents/domain/file.ts` |
| Longest run per call (`maxDuration`): sync 60 s, scheduler, exports and the year-end close 300 s | the route files |
| Daily Vercel Cron calling the scheduler with `GET` and `Authorization: Bearer $CRON_SECRET` | `vercel.json`, `src/app/api/push/dispatch/route.ts` |
| Client IP for the rate limits from `x-vercel-forwarded-for` (`CLIENT_IP_HEADER`) | `src/lib/security/rate-limit.ts`, `src/lib/env.ts` |
| Functions in Paris (`cdg1`), next to Supabase's Paris region | `vercel.json` |
| The service worker built and made static during the deploy, its precache revision the deployment's id | `src/app/serwist/[path]/route.ts`, `next.config.ts` |

You need: a GitHub account with access to the repository, a laptop with the repository cloned, Node 24, pnpm
(`corepack enable`), `openssl`, and the PostgreSQL 17 (or later) client tools for backups (`pg_dump`, `psql`).

## 1. Supabase project

1. Create the project at supabase.com:
   - **Region: West EU (Paris)** (`eu-west-3`). Closest to Morocco and to Vercel's `cdg1`.
   - **Database password:** letters and digits only, so it needs no escaping in a URL: `openssl rand -hex 24`. Keep it
     in your password manager.
   - If the form offers **Enable Data API**, untick it.
2. **Turn the Data API off** (if it wasn't at creation): Integrations → Data API → turn **Enable Data API** off.
   Supabase publishes the `public` schema over HTTP to anyone holding the project's anon key, which is public by
   design. The app never uses that API: it talks to PostgreSQL directly. Belt and braces: the migrations also put every
   table under row level security with no policy, so even with the API on, the anon and authenticated roles get no
   row. The app is not affected: it connects as the tables' owner.
3. **Enforce TLS:** Database → Settings → SSL Configuration → turn **Enforce SSL on incoming connections** on, and
   **download the certificate** there (`prod-ca-2021.crt`, Supabase's own CA). Save it in the repository folder on your
   laptop as `supabase-ca.pem` (the `.pem` name is git-ignored).
4. **PostgreSQL version:** Settings → Infrastructure shows it. The migrations use PostgreSQL 18's `uuidv7()`. If the
   project runs an older version (Supabase offered 15 and 17 when this was written), open the SQL Editor, paste
   the content of `prisma/uuidv7-before-pg18.sql` and run it, **once, before the first migration**.
5. **Connection strings:** click **Connect** at the top of the project. Copy two of them (the user is
   `postgres.<project ref>`, the host something like `aws-0-eu-west-3.pooler.supabase.com`):
   - **Transaction pooler**, port **6543**: the app's `DATABASE_URL` on Vercel.
   - **Session pooler**, port **5432**: for migrations, the seed and backups from your laptop. (The "direct connection"
     `db.<ref>.supabase.co` works too, but only over IPv6 unless you buy the IPv4 add-on.)

   Replace `[YOUR-PASSWORD]` with the password from step 1.

## 2. Migrations and reference data, from your laptop

In the repository folder (with `supabase-ca.pem` from step 1.3), in git-bash or a shell:

```sh
pnpm install --frozen-lockfile

# Prisma's migrate engine: TLS required.
export DIRECT_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres?sslmode=require'
# The seed and pg_dump (node-postgres, libpq): TLS verified against Supabase's CA.
export DATABASE_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=supabase-ca.pem'

pnpm exec prisma migrate deploy   # every migration; reads DIRECT_URL (prisma.config.ts)
pnpm exec prisma db seed          # strains, catalogues, chart of accounts; idempotent
DEMO_PHONE=+2126XXXXXXXX pnpm db:seed:demo   # optional: the demo farm, owned by that phone
```

- Two URLs because the tools read TLS settings differently: Prisma's engine only knows `sslmode=require` (encrypted;
  it accepts any certificate unless told otherwise), while node-postgres reads `require` as "verify the certificate",
  which fails without Supabase's CA, hence `verify-full` with `sslrootcert`. `sslrootcert` is a path from the current
  folder: run the commands from the repository folder.
- Run the same two commands (`migrate deploy`, `db seed`) after every release that has migrations, **before**
  Vercel deploys the new code (or right after, if the migration only adds things). Take a backup first (section 6).
- These variables win over the laptop's `.env` for as long as the shell is open; close it afterwards. Never put
  `DIRECT_URL` or Supabase's URL in `.env`: `pnpm db:migrate` would then migrate Supabase.
- `prisma migrate deploy` must run as the same role the app uses (`postgres.<ref>` here): the tables' owner is not
  subject to row level security, any other role without `BYPASSRLS` would see no rows.

## 3. Vercel project

1. vercel.com → **Add New… → Project** → import the GitHub repository. Framework preset: **Next.js** (detected). Leave
   the build and install commands empty: Vercel runs `pnpm install` (whose `postinstall` runs `prisma generate`), then
   `pnpm build`. The build needs no database.
2. Before the first deploy, in the project's **Settings**:
   - **Build and Deployment → Node.js Version: 24.x** (as CI).
   - **Functions → Fluid compute: on** (the default for new projects). The 300 s `maxDuration` of the scheduler,
     exports and close needs it on the Hobby plan (without Fluid compute, Hobby functions stop at 60 s).
   - **Functions → Function Region:** nothing to do, `vercel.json` sets Paris (`cdg1`).
   - **Production branch** (Settings → Environments → Production): the branch the demo runs from, usually `main`.
3. **Environment Variables:** add each one for the **Production** environment only (see "Previews" below). Generate the
   secrets on your laptop; paste each value without spaces or line breaks around it.

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **transaction pooler** string (port 6543), with the password. No `?sslmode`: the next variable decides TLS |
| `DATABASE_CA_CERT` | the whole content of `supabase-ca.pem`, `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----` (multi-line is fine) |
| `DATABASE_POOL_MAX` | `3` (see "Database connections") |
| `APP_ORIGIN` | `https://<project>.vercel.app`, or `https://<your domain>` once it is attached; no trailing slash. Must match the address in the browser exactly |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `CAPTCHA_HMAC_KEY` | `openssl rand -base64 32` (a different value) |
| `CRON_SECRET` | `openssl rand -hex 32` (letters and digits: Vercel sends it in a header) |
| `CLIENT_IP_HEADER` | `x-vercel-forwarded-for` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`: Vercel then installs the pnpm version of `package.json`'s `packageManager` (10.32.1) instead of guessing from the lockfile |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | optional, push notifications: `node -e "console.log(require('web-push').generateVAPIDKeys())"` in the repository folder. Both or neither. The public key is built into the pages: changing it needs a redeploy |
| `VAPID_SUBJECT` | with the VAPID keys: `mailto:<an address you read>` |

   Plus whatever the login of ADR-015 adds (password login, being built; see section 5). Leave out `DIRECT_URL`,
   `TRUSTED_PROXY_HOPS` (replaced by `CLIENT_IP_HEADER`) and every test-only variable of `.env.example`
   (`CAPTCHA_DISABLED`, `OTP_CONSOLE_SINK`, `ALLOW_TEST_SERVER_IN_CI`, `STRICT_MESSAGES`, `ALLOW_DEMO_SEED`).
   With a missing or unsafe value, the server refuses to start and the function logs (Vercel → Logs) name the variable
   (never its value); every page then answers an error.
4. **Deploy** (Deployments → Redeploy, or push to the production branch). Then check
   `https://<domain>/api/health`: `{"status":"ok"}` means the app reaches the database.
5. **Domain** (optional): Settings → Domains → add it, set the DNS records Vercel shows, wait for the certificate. Then
   change `APP_ORIGIN` to `https://<domain>` and **redeploy** (a deployment keeps the variables it was built with). The
   `*.vercel.app` address then fails every write (CSRF compares the browser's `Origin` with `APP_ORIGIN`): use the
   domain only.

### Previews

Preview deployments (other branches, pull requests) get other addresses, and `APP_ORIGIN` is one exact origin, so a
preview could only read. Decided: **previews are not used for the demo.** With the variables set for Production only,
a preview builds but refuses to start (missing `DATABASE_URL`, `APP_ORIGIN`, …), so it can't touch the demo database
either. To stop building them at all: Settings → Git → **Ignored Build Step**: "Only build production".

## 4. Scheduler (Vercel Cron)

`vercel.json` declares one cron job: `GET /api/push/dispatch` at `0 5 * * *` (UTC, so 06:00 in Morocco). Vercel adds
`Authorization: Bearer <CRON_SECRET>` itself; the route compares it in constant time and answers 404 to anything else.
It sends the reminders (vaccinations, cheques and bills, placements, documents, loan installments), posts the pending
journal entries and sends the pushes that are due. Cron jobs run on the production deployment only.

- **Hobby plan: once a day**, at some minute of that hour; a more frequent schedule makes the deploy fail. So the
  reminders arrive once a day (they are about days anyway), and **push notifications wait for the next run**: an
  urgent alert (climate out of range, power cut) still shows in the app's inbox at the next sync, but reaches the
  phone's notification bar up to a day late. The books don't wait: every finance page catches the postings up when it
  opens (`catchUpBooks`), and each sync posts what it brought.
- **Pro plan: every minute.** Change the schedule in `vercel.json` to `* * * * *` and deploy.
- Logs: Settings → Cron Jobs → View Logs. A run that had a failing step answers 500 and names it; Vercel doesn't retry.
- Check it by hand: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/push/dispatch`.
- Rotating `CRON_SECRET`: change it, then redeploy; the deployment and its cron use the new value together.

## 5. First owner sign-up

Production can't send login codes by SMS until a provider is chosen (OQ2), so phone login doesn't work on the demo.
Login with a password (ADR-015) is being built: the owner's first sign-up follows that ADR's steps once it is merged.
Until then the demo can only be shown with the seeded demo farm on a local or Docker build.

## 6. Backups

- **Supabase:** the Free plan has **no** backups (it suggests exporting yourself); Pro keeps 7 days of daily backups,
  restorable from the dashboard (Database → Backups).
- **Ours:** `scripts/backup.sh` works against Supabase from the laptop, with the session pooler URL of section 2
  (needs `pg_dump` 17 or later, gpg, bash):

  ```sh
  DATABASE_URL='postgresql://postgres.<ref>:<password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=supabase-ca.pem' \
  BACKUP_DIR=~/poultry-backups BACKUP_PASSPHRASE_FILE=~/.poultry-backup.pass scripts/backup.sh
  ```

  Restore into a fresh database with `scripts/restore.sh` (`docs/backup.md`). Do it before every release with
  migrations, and daily while the demo has data worth keeping.

## Database connections

- Every Vercel function instance has its own pg pool. `DATABASE_POOL_MAX=3` lets one instance serve a few requests at
  once (Fluid compute shares an instance between requests) without holding many connections; Supavisor multiplexes
  them onto the database's own connections. Supabase recommends 1; 3 is a decided default, to review if the logs show
  "timeout exceeded when trying to connect".
- Transaction mode gives a connection for one transaction only. The code is safe with it: pg sends unnamed statements
  (no prepared statement survives the transaction), locks are `pg_advisory_xact_lock` only, and there is no `SET`,
  `LISTEN` or temporary table.
- An interactive transaction gives up after 15 s, waiting at most 5 s for a connection (`SYNC_TX`): well inside the
  60 s and 300 s `maxDuration`.

## Known limits on the Hobby plan

- Cron once a day: pushes up to a day late (section 4).
- One function region; 300 s at most per call; request bodies up to 4.5 MB (uploads are capped at 4 MiB for this).
  Responses over 4.5 MB need streaming, which Vercel enables by default for Node.js functions: to check once with a
  month's export holding many receipts.
- Usage included: 1 million function invocations, 4 hours of active CPU and 100 GB of transfer a month. Plenty for a
  demo.
- Vercel describes Hobby as meant for personal, non-commercial projects: read the Hobby plan terms before showing it to
  a client, or use Pro.
- Supabase Free: 500 MB of database (uploaded files live in it, ADR-011), no backups, and the project pauses after a
  week without activity (restore it from the dashboard).
- Rate limits per IP work (`CLIENT_IP_HEADER`); Vercel overwrites `X-Forwarded-For` too, so `TRUSTED_PROXY_HOPS=1`
  would also be right, but the dedicated header stays right if a proxy is ever put in front.
- The service worker (`/serwist/sw.js`) is built during the deploy and served as a static file; a function can't build
  it (no esbuild, no sources in it). If no deploy happens for 30 days, Next tries to rebuild it once in the background,
  which fails on Vercel and keeps the built file: harmless.

## Decided defaults, to review

1. **TLS:** `DATABASE_CA_CERT` with full verification on Vercel; `sslmode=require` (unverified) for Prisma's migrate
   engine from the laptop, `verify-full` for the seed and `pg_dump`.
2. **Data API off and RLS on every table** (both). Every future migration that creates a table must also enable RLS on
   it: `src/lib/db.int.test.ts` fails otherwise.
3. **`uuidv7()` stand-in** for PostgreSQL < 18, run by hand before the first migration (not a migration: it must exist
   before the first one).
4. **Upload cap 4 MiB** everywhere (Docker too), not configurable: one number, the same messages in French and Arabic.
5. **`maxDuration`:** 60 s for sync push and pull, 300 s for the scheduler, the month's export and the close page.
6. **Cron:** daily at 05:00 UTC on Hobby; every minute on Pro.
7. **Client IP:** `CLIENT_IP_HEADER=x-vercel-forwarded-for`.
8. **Region:** Vercel `cdg1` (Paris) + Supabase `eu-west-3` (Paris).
9. **Previews:** not used; variables for Production only.
10. **`DATABASE_POOL_MAX=3`** per function instance.
11. **Service worker revision:** Vercel's deployment id (`VERCEL_DEPLOYMENT_ID`), a random id per build elsewhere
    (`next.config.ts`, `SW_REVISION`), inlined at build time: a new one per deploy, the same across cold starts. It used
    Next's `.next/BUILD_ID`, which the build workers read before Next writes it: a missing file ("unbuilt", the same
    for every deploy) or the previous build's id.
