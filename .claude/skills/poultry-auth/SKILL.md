---
name: poultry-auth
description: Authentication and abuse-protection rules for the poultry farm platform (Next.js 16 PWA + PostgreSQL). Covers phone-number + one-time-code login (SMS/WhatsApp), invitations by phone, roles (owner/manager/worker), server-side sessions that survive offline use, cookies, CSRF for route handlers, multi-dimensional rate limiting, SMS-pumping protection, captcha, uniform responses and auth audit. Use this skill whenever touching login, logout, OTP, invitations, members, roles, sessions, cookies, CSRF, rate limits, captcha, the identity module, the sync endpoints' auth, or any unauthenticated endpoint, even if the user only says "add an endpoint" or "fix login".
---

# Poultry platform: authentication and abuse protection

Adapted from the `cdoc-auth` skill (EMSI portal):
- **phone + OTP is the only login method.** There is no Entra / Google / email login.
- **offline-first sessions.** A worker stays logged in on a farm with no network.
- **SMS cost is an attack surface** (SMS pumping).

Decisions: ADR-005 (auth), ADR-006 (tenancy + audit), ADR-007 (law 09-08). Requirements: SPEC §8 `identity` I1–I5.

## 0. Critical rules (read even if nothing else)

1. **Identity key = `User.id`.**
   - The phone number (E.164, `+2126…` / `+2127…`) is the login identifier.
   - It is unique per user. It is stored normalized through the `PhoneNumber` value object.
   - Changing a number = re-invitation by the owner. Never merge users.
2. **Authentication ≠ access.** A valid code alone gives nothing:
   - **Owners** may sign up freely. A first login with no membership → onboarding creates their organisation.
   - **Managers and workers** get access only through a pending **invitation** for that phone number from an owner.
   - Every request checks an active `Membership` (user × organisation × role).
3. **Sessions are opaque and server-side** (Postgres `Session` table).
   - No JWT sessions, no tokens in `localStorage` / IndexedDB.
   - Revocation takes effect on the next online request: member removed, role changed (`roleVersion` bump), owner "log out all devices".
4. **Cookie:** `__Host-sid; HttpOnly; Secure; SameSite=Lax; Path=/`, with an explicit expiry.
   - Never `Strict`: it breaks opening the app from a WhatsApp / SMS link.
   - Chrome and Firefox accept `Secure` on `http://localhost`, so the same name works in dev.
5. **Offline:**
   - The session lasts **30 days, sliding** (renewed on each online request), with an **absolute maximum of 90 days**.
   - The client caches user, memberships and permissions to render offline.
   - **An expired session never deletes the outbox.** Queued mutations wait for the next login, and they are re-checked against the new session's permissions when pushed.
6. **Rate limit on several dimensions at once:** IP, subnet, target phone, global. One dimension alone is always bypassable. See `references/rate-limiting.md`.
7. **SMS pumping protection:**
   - only Moroccan mobile numbers (`+2126`, `+2127`) can receive codes;
   - a global hourly cap on codes sent, with an alert;
   - a captcha before every code request;
   - a per-number cap.
   - Every code costs money. Treat the send endpoint as a payment endpoint.
8. **Captcha is verified server-side and is single-use** on the code request. Never trust a client flag. See `references/captcha.md`.
9. **Uniform failures.** The code request always answers `202 {"status":"sent_if_eligible"}`. Verification failures (unknown number, wrong code, expired, locked) all give the same `401 INVALID_OR_EXPIRED_CODE` with similar timing. Never reveal whether a number has an account.
10. **Trust `X-Forwarded-For` only from the configured proxy** (hosting is open, ADR-007). Otherwise every IP-based limit can be bypassed with one header.
11. **Stop and ask before changing** the cookie name, the session or pepper secrets, session lifetimes, the SMS / WhatsApp provider, or the allowed phone prefixes. Each one logs everyone out, breaks login, or changes cost / legal exposure (ADR-007: a provider is a data processor).

## 1. Who logs in how

| Population | Method | Access condition |
|---|---|---|
| Farm owner | Phone + code | Self sign-up → onboarding creates the organisation. Later logins need an active `owner` membership |
| Manager, worker | Phone + code | Pending, unexpired invitation for that number (accepted at first login), then an active membership |
| Vet, accountant (M5) | Phone + code | Invitation scoped by `partner-access`, with the owner's consent |

Roles: `owner`, `manager`, `worker`. Partner roles come in M5. The role → action table lives in `src/lib/permissions.ts`, read through `can(ctx, action)`. Never check role names inline.

**Workers never receive** prices, costs, amounts or supplier credit. This is stripped in serializers on the server, not just hidden in the UI.

## 2. Where things live (Next.js)

```
src/modules/identity/
  domain/          PhoneNumber, OtpChallenge rules, Invitation, Membership/roleVersion (pure)
  application/     requestCode, verifyCode, acceptInvitation, inviteMember, removeMember, logout, logoutEverywhere
  infrastructure/  session store (Prisma), OTP hasher (node:crypto HMAC), SMS/WhatsApp sender port + adapters, dev console sink
  schema.ts        Zod: RequestCode, VerifyCode, InviteMember…
  index.ts
src/lib/
  session.ts       getSession() → TenantContext | anonymous: the ONLY code that reads the cookie
  permissions.ts   can(ctx, action)
  security/
    rate-limit.ts  consume(policyName, dims) using the policies in config
    captcha.ts     verifyCaptcha(payload) + single-use store
    csrf.ts        assertSameOrigin(req) for route handlers
src/app/api/auth/  request-code, verify-code, logout route handlers
```

- **One choke point:** `getSession()` turns the cookie into a `TenantContext` (or anonymous), once per request. Pages, server actions, route handlers and the sync endpoints all use it. Nothing else reads the cookie.
- **Order in every route handler:** rate limit → captcha (if declared) → CSRF (state-changing) → session → `can()` → Zod validation. Rate limiting runs first, so unauthenticated floods are cut cheaply.
- **Server actions** get Next's built-in Origin vs Host check (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`). They still call `getSession()` + `can()`, and still validate with Zod.

## 3. Sessions

- Session id: 32 bytes from a CSPRNG, base64url. **Store only its SHA-256 hash.** The cookie carries the raw value.
- **Regenerate it on login and on role change** (session fixation).
- The row stores `userId`, `createdAt`, `lastSeenAt`, `expiresAt`, `absoluteExpiresAt`, `roleVersion`, user agent, a coarse IP (/24 or /64). Lifetimes come from config, not code.
- A `roleVersion` or membership mismatch → 401 on the next request, and the client goes to login **without clearing the outbox**.
- Logout:
  - deletes the server row and clears the cookie;
  - **refuses while there are unsynced changes**, unless the user explicitly confirms losing them (`sync.pendingCount > 0`).
- Required features: "log out all my devices" (user) and "remove member → revoke sessions" (owner).

## 4. CSRF

`SameSite=Lax` alone is not enough for our JSON route handlers. For every state-changing route handler (POST/PUT/PATCH/DELETE, including `/api/sync/push`):
- reject when `Origin` (or `Referer` when `Origin` is absent) is not exactly `APP_ORIGIN`;
- require the custom header `X-Requested-With: poultry`. The PWA's fetch wrapper sets it. Cross-site forms cannot.

Server actions are covered by Next's own check (§2).

## 5. OTP rules

- 6 digits from `crypto.randomInt`, **hashed with HMAC-SHA256 and `OTP_PEPPER`** (`node:crypto`, no extra dependency), stored in `OtpChallenge`.
- **Valid 5 minutes** (SPEC I1), single use. After **5 wrong attempts** the challenge is destroyed. A new request invalidates the previous challenge for that number.
- Compare with `crypto.timingSafeEqual`.
- The message contains the code and the app name only. No link (link scanners prefetch). Templates exist in `ar` and `fr`, in the user's language or `ar` by default.
- **Delivery goes through a sender port** (`SmsSender`).
  - Dev / test: a console sink that prints the code.
  - **The app refuses to start with the console sink when `NODE_ENV=production`.**
  - Production provider: open (SPEC OQ2).
- Never log the code, the hash, the session id or the full phone number. Log the phone as `+2126•••••12`.

## 6. Audit (ADR-006)

Write an audit event for:
- code requested (eligible or not);
- verification failure (reason code);
- login success;
- invitation created / accepted / expired;
- member role change or removal;
- sessions revoked;
- logout;
- rate-limit block;
- captcha failure.

Include `userId` when known, the masked phone, a coarse IP and the user agent. **Never** log codes, session ids or captcha payloads.

## 7. Workflow for any auth task

1. Find the existing mechanism in `identity/` and `src/lib/security/`, and extend it. Never create a second auth path.
2. Declare a rate-limit policy (and a captcha mode) for any new unauthenticated or costly endpoint, using the tables in the references. If no policy fits, add one to config. Never put numbers inline.
3. Libraries:
   - The auth library choice (Better Auth phone-OTP plugin vs. a minimal in-house version on our `Session` table) is made in **T5** and recorded in ADR-005.
   - `rate-limiter-flexible` and `altcha` / `altcha-lib` are candidates. **Adding any of them is "ask first"** (SPEC §7).
   - Check the installed version's docs. Don't write library APIs from memory. Pin security libraries to exact versions.
4. Prove each change by sending real requests (`references/test-matrix.md`). Reading the diff is not verification. If a step needs a real SMS provider, say that this step is unverified.

## 8. Checklist

- [ ] Phone normalized through `PhoneNumber` (+2126 / +2127 only)
- [ ] Access needs an active membership or a valid invitation (owners: onboarding)
- [ ] Session hash stored, id regenerated on login / role change, logout deletes server state and protects unsynced data
- [ ] Cookie flags exactly as §0.4
- [ ] Rate-limit policy declared with at least IP + target-phone + global dimensions
- [ ] Captcha on code requests, verified server-side, single use
- [ ] CSRF check on state-changing route handlers
- [ ] Uniform responses and timing on code endpoints
- [ ] Workers' responses contain no money fields (serializer test)
- [ ] Audit events written, nothing secret logged
- [ ] Test matrix executed, results reported

## 9. Anti-patterns to reject

- Logging in by phone number without a code (for example "remember this phone").
- Storing the session token or the OTP in IndexedDB / `localStorage` for offline use. Cache the **permissions**, not the credential.
- Rate limiting on IP only, or reading `x-forwarded-for` without a trusted proxy.
- Hard-locking a farmer's account after N failures. That lets an attacker lock out a real farmer. Use backoff + captcha + IP/subnet blocks instead.
- Sending codes to any country code "to be flexible" (SMS pumping).
- Different messages for "unknown number" and "wrong code".
- Clearing the outbox on logout or on session expiry.
- Hiding money fields only in React for workers.
