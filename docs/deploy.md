# Deploying

One Docker image (`Dockerfile`) runs the app with `next start` on port 3000. The host is not chosen yet (OQ1), so every
host-specific value below is in "Needs owner". Everything here is host-independent: any machine with Docker, a
PostgreSQL 18 database and a TLS reverse proxy will do.

## Build

```sh
docker build --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key> -t poultry:<git sha> .
```

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build time, so it is a build argument (it is
  public, not a secret). The image also carries it as a run-time variable, so don't set it again at run time. Leave it
  out to build without push (then leave `VAPID_PRIVATE_KEY` empty too). A new key means a new image.
- No secret is baked in: `.dockerignore` keeps `.env*`, `.git`, `node_modules`, `.next` and `.claude` out, and every
  secret is given at run time.
- The image is a full install (development dependencies included), because the release step below runs Prisma from
  the same image. Build it once and run that same image everywhere; don't rebuild per environment.
- CI builds it on every pull request (`docker` job in `.github/workflows/ci.yml`, build only, nothing pushed).

## Environment

Put the run-time variables in a root-only file on the host, e.g. `/etc/poultry/app.env` (mode 600). Every variable is
listed in `.env.example`. With `NODE_ENV=production` (set by the image) the server refuses to start, logs the variable
names (never the values) and exits with code 1 when (`src/lib/env.ts`):

- `DATABASE_URL` is missing;
- `APP_ORIGIN` is not the site's exact `https://` origin (scheme and host, no path, no trailing slash);
- `BETTER_AUTH_SECRET` or `CAPTCHA_HMAC_KEY` is missing, shorter than 32 characters, or the `.env.example` placeholder
  (generate each with `openssl rand -base64 32`);
- `CAPTCHA_DISABLED=true` or `OTP_CONSOLE_SINK` is set (both test only);
- `TRUSTED_PROXY_HOPS` is unset (it must be a decision, see "Reverse proxy");
- only one of the two VAPID keys is set, or the keys are set without `VAPID_SUBJECT`.

It starts but warns when `TRUSTED_PROXY_HOPS=0` (no per-IP rate limits) or `CRON_SECRET` is unset (no reminders, pushes
or postings catch-up).

A minimal file:

```sh
DATABASE_URL=postgresql://poultry:…@db.internal:5432/poultry
APP_ORIGIN=https://<domain>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
CAPTCHA_HMAC_KEY=<openssl rand -base64 32>
TRUSTED_PROXY_HOPS=1
CRON_SECRET=<openssl rand -base64 32>
VAPID_PRIVATE_KEY=<private key of the pair built in>
VAPID_SUBJECT=mailto:<ops address>
```

**Login codes need an SMS provider (OQ2).** Until one is wired in `src/modules/identity/infrastructure/sms.ts`, a
production server refuses to send codes, so nobody can log in. See "Needs owner".

## Release step (once per new image)

Migrations and reference data run as a separate one-shot container from the same image, before the new app container
starts, never on every start:

```sh
docker run --rm --env-file /etc/poultry/app.env poultry:<git sha> sh -c "prisma migrate deploy && prisma db seed"
```

`prisma db seed` is what `pnpm db:seed` runs (`prisma.config.ts`); it is idempotent, so running it on every release is
safe. Take a backup first when the release has migrations (`docs/backup.md`). The demo farm (`prisma/demo.ts`) refuses
to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set: never on the pilot's database.

## Run

```sh
docker run -d --name poultry --restart unless-stopped --env-file /etc/poultry/app.env \
  -p 127.0.0.1:3000:3000 --stop-timeout 30 poultry:<git sha>
```

- **One app instance.** Next generates a Server Functions encryption key per build and embeds it in the build output;
  Next's cache is per process too. More instances need,
  per the Next.js self-hosting guide ("Multi-Server Deployments"): the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
  (base64 of 16, 24 or 32 bytes: `openssl rand -base64 32`) set when building, a shared Next cache handler, and a
  `deploymentId`. None of that is wired (the Dockerfile has no such build argument): run one container for the pilot.
- **Port** 3000, published on loopback only: the reverse proxy is the only way in.
- **Health:** `GET /api/health` answers 200 `{"status":"ok"}` when the app and its database are up, 503 otherwise.
  The image's `HEALTHCHECK` calls it every 30 s; `docker ps` shows `healthy`. Point the host's uptime check at it too.
- **Stop:** `tini` is PID 1 and passes `SIGTERM` on to `next start`, which stops accepting connections, finishes the
  requests in flight and exits with code 143 (128 + SIGTERM: Next's own exit after a clean drain). `--stop-timeout 30`
  gives it 30 s before Docker kills it; exit code 137 means it had to.
- **Logs** go to stdout/stderr (`docker logs poultry`). A server error is one JSON line with the path, method, error
  name and digest, never the body, cookies or query (`src/instrumentation.ts`).
- **Service worker:** its precache revision is the git commit, read with `git` at server start. The image has no git,
  so the revision is a random id per start: after each restart, phones download the 52 precached page shells again
  (about 13 KB each). Harmless; give the route a build-time revision if that traffic matters.
- **Refused start:** an unsafe env exits with code 1 and `--restart unless-stopped` keeps retrying; `docker logs poultry`
  names the variables to fix.

### Upgrade

1. `docker build …` the new image (or pull it from the registry, once there is one).
2. Backup, then the release step with the new image.
3. `docker stop poultry && docker rm poultry`, then `docker run …` the new image. A few seconds of downtime; the phones
   queue their writes offline and sync when it is back.

Rollback: run the previous image. Migrations only go forward, so a release with a migration that the old code can't
work with needs a restore of the pre-release backup instead (`docs/backup.md`).

## Reverse proxy (TLS)

The app speaks plain HTTP and expects a TLS reverse proxy in front (nginx, Caddy, the host's load balancer):

- **TLS** with automatic renewal; HTTP redirects to HTTPS. The app already sends `Strict-Transport-Security`.
- **`TRUSTED_PROXY_HOPS`** = the number of proxies that append to `X-Forwarded-For` in front of the app: 1 for a single
  nginx or Caddy, 2 for a CDN or load balancer in front of it, and so on. The per-IP rate limits read the client IP
  that many entries from the right (`src/lib/security/rate-limit.ts`). Too high and one forged header picks the IP;
  too low and every request looks like it comes from the proxy.
- **The proxy must set `X-Forwarded-For`**, appending the client address (nginx:
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; Caddy does it by default), and pass the `Host`
  header through unchanged: CSRF compares `Origin` with `APP_ORIGIN`.
- **Compression:** brotli, or gzip, at the proxy for text responses (HTML, JS, CSS, JSON, SVG). nginx:
  `gzip on; gzip_types …`, plus the brotli module if the host has it; Caddy: `encode zstd gzip` (brotli needs a plugin).
- **Streaming:** don't buffer responses (nginx: `proxy_buffering off;` for this upstream), or pages lose their
  streamed loading states.
- **Body size:** at least 6 MB. Uploads are capped at 5 MiB by the app (`MAX_FILE_BYTES`) and a sync push at 2 MB;
  nginx's default 1 MB (`client_max_body_size`) refuses both.

## Scheduler (every minute)

Reminders, pushes and the postings catch-up run when the host's scheduler calls the dispatch route with `CRON_SECRET`:

```cron
* * * * * curl -fsS -m 50 -X POST -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/push/dispatch > /dev/null
```

The method is `POST`. A missing or wrong token gets a 404 (as does every call while `CRON_SECRET` is unset). Keep the
token out of the crontab line itself: read it from a root-only file (e.g. `CRON_SECRET=$(cat /etc/poultry/cron.secret)`
in a small script). Calling `http://127.0.0.1:3000/api/push/dispatch` on the host also works and skips the proxy.

## Backups

A daily `pg_dump`, encrypted, with retention, from the host's cron: `docs/backup.md` (scripts, cron line, restore,
drill). The dumps must also be copied off the host: see "Needs owner".

## Rotating secrets

| Secret | Effect of a change | How |
|---|---|---|
| `BETTER_AUTH_SECRET` | **Logs everyone out**: session cookies are signed with it, and Better Auth 1.7 checks the signature with the current secret only. Its versioned `BETTER_AUTH_SECRETS` keeps old keys for encrypted data (cookie cache, OAuth tokens), which this app doesn't use, so it doesn't help here. | Change it and restart, at a quiet hour; users log in again with an SMS code (cost: one SMS each). |
| `CAPTCHA_HMAC_KEY` | Safe. Challenges handed out in the last 5 minutes fail once; the phone fetches a new one. | Change it and restart. |
| VAPID keys | **Breaks every push subscription**: phones subscribed with the old public key get no push until they subscribe again. | Only if the private key leaked. New pair, rebuild the image with the new public key, set the new private key, run it. |
| `CRON_SECRET` | The dispatch route answers 404 to the old token. | Change it in the app's env and in the scheduler together, then restart the app. |
| Database password | The app can't connect until `DATABASE_URL` matches. | Change it in PostgreSQL and `DATABASE_URL` together, restart. |

Restart = stop the container and run it again with the new env file (the env is read at start).

## Needs owner

- **Host** (OQ1): where the app and PostgreSQL 18 run, size, and who has access. The database must not be reachable
  from the internet.
- **Domain and TLS:** the domain name (`APP_ORIGIN`), DNS, and the certificate (automatic renewal).
- **`TRUSTED_PROXY_HOPS` value:** depends on what sits in front of the app on that host (proxy, load balancer, CDN).
- **Scheduler:** what calls `/api/push/dispatch` every minute (host cron, the platform's scheduler) and who watches it.
- **Off-site backup storage:** where the daily dumps are copied, and who holds the passphrase (`docs/backup.md`).
- **SMS vendor** (OQ2): without it production can't send login codes, so nobody can log in.
- **Alert channel:** where the health check, a failed backup and a failed scheduler call raise an alert, and who gets
  it.
- **Image registry:** where built images are kept (until then, build on the host).
