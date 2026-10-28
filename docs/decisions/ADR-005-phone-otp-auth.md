# ADR-005: Phone number + one-time code, database sessions

## Status
Accepted (2026-10-28, task T5): **Better Auth 1.7.14** behind our own route handlers. The SMS / WhatsApp provider is still open (SPEC OQ2), and so is the captcha (deferred to before the pilot).

## Date
2026-10-27

## Context
- Many farmers and workers have no email address, or never check it. Every user has a mobile number, and most use WhatsApp.
- Workers share phones and change jobs.
- Offline use means a session must last for days without contacting the server.

## Decision
- **Identifier:** a Moroccan mobile number in E.164 format (`+2126…` / `+2127…`). Email is optional.
- **Login:** a 6-digit one-time code (OTP), sent by SMS or WhatsApp.
  - The code is stored **hashed**.
  - It expires after 5 min.
  - It is locked after 5 wrong attempts.
  - A number can request at most 3 codes per 15 min. There is also a limit per IP.
  - In development, codes are printed to the server console. **They are never logged in production.**
- **Sessions:** a random token stored in a `Session` table, sent in a cookie (`httpOnly`, `Secure`, `SameSite=Lax`).
  - A session lasts 30 days, renewed on each online use.
  - The owner can revoke the sessions of any member.
- **Offline:** the client caches the user, the memberships and the permissions. A session that expired while offline keeps local entries queued until the user logs in again.
- **Library:** Better Auth 1.7.14, confirmed in T5. See "Library decision" below.

- **Abuse protection** follows `.claude/skills/poultry-auth/` (added on 2026-10-27, adapted from the EMSI `cdoc-auth` skill). On top of the per-number limits, it adds:
  - multi-dimensional rate limits (IP, subnet, phone, number prefix, global);
  - protection against **SMS pumping**: Moroccan mobile numbers only, plus a global hourly cost cap with an alert;
  - a self-hosted captcha (ALTCHA candidate) on code requests;
  - uniform responses;
  - a 90-day absolute session cap;
  - CSRF checks on route handlers.

## Library decision (T5, 2026-10-28)
Chosen by the product owner: **Better Auth 1.7.14** (exact pin) with its `phoneNumber` plugin and the Prisma adapter. The in-house alternative (about 200 lines on `node:crypto` and our own `Session` table, no dependency) was recommended for exact fit with `poultry-auth`, and was not chosen.

How it is wired:
- **Better Auth is the engine only.** Its HTTP handler is not mounted. Our route handlers (`src/app/api/auth/{request-code,verify-code,logout}`) run CSRF, the rate limits and uniform responses, then call `auth.api.*` on the server (`src/modules/identity/`).
- **Rate limiting is ours,** in Postgres (`src/lib/security/rate-limit.ts`, policies in `policies.ts`): phone 3 / 15 min and 10 / day, number prefix 30 / h, a global 300 codes / h cost cap, plus IP and subnet limits. IP and subnet count only once a trusted proxy is configured (`TRUSTED_PROXY_HOPS`, ADR-007), because without one `X-Forwarded-For` is client-controlled. Better Auth's own limiter is off.
- **OTP:** 6 digits, 5 min, locked after 5 wrong attempts; only `+2126` / `+2127` numbers get a code. The first verified login creates the user (`signUpOnVerification`, placeholder email `<digits>@phone.invalid`).
- **Sessions:** 30 days, sliding daily; our `getSession()` adds the 90-day absolute cap.
- **Dev sink:** codes go to the server console. The production build refuses this unless `OTP_CONSOLE_SINK=1`, which only CI's e2e job sets.

Accepted differences from `poultry-auth` (consequences of using the library as it is):
- **One-time codes are stored unhashed** in `Verification.value` (`<code>:<attempts>`) and compared with `!==`, not in constant time. They live 5 minutes and are single-use; anyone with database read access could use a pending code.
- **Session tokens are stored unhashed** in `Session.token`. The cookie carries the token plus an HMAC signature. Database read access would allow session hijacking: restrict database access accordingly (ADR-007).
- **Cookie name is `__Secure-sid`, not `__Host-sid`.** Better Auth always prefixes `__Secure-` when secure. Attributes stay `HttpOnly; Secure; SameSite=Lax; Path=/`, with no `Domain`, so only `__Host-`'s protection against subdomain cookie injection is lost.
- **Sliding refresh extends the database row, but not the cookie, when the session is read from a page.** Route handlers that forward Better Auth's headers refresh both (the sync endpoints in T8 will).

Not done in T5:
- the captcha on code requests (ALTCHA candidate): before the pilot, with T26;
- auth audit events: `AuditEvent` requires an `organizationId`, so they come with the tenant context (T6);
- logout refusing while unsynced changes exist: with the outbox (T9).

## Alternatives Considered
- **Email + password:** rejected. It doesn't match the users, and passwords on shared phones are a risk.
- **Password-less login by email link:** rejected for the same reason.
- **JWT stored on the client:** rejected. It is harder to revoke when a worker leaves, and database sessions are simple enough.

## Consequences
- SMS / WhatsApp messages cost money, and the per-number limits protect both cost and security.
- The production provider must be chosen before the pilot (OQ2).
- Losing access to a phone number is a support case: an owner can re-invite a member under a new number.
