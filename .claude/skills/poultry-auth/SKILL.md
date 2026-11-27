---
name: poultry-auth
description: Authentication and abuse-protection rules for the poultry farm platform (Next.js 16 PWA + PostgreSQL). Covers password login with the phone number or the email (ADR-015), one-time invite and reset codes, roles (owner/manager/worker/vet/accountant), server-side sessions that survive offline use, cookies, CSRF for route handlers, multi-dimensional rate limiting, captcha, uniform responses and auth audit, plus the dormant SMS one-time-code login (AUTH_SMS_ENABLED) and its SMS-pumping protection. Use this skill whenever touching login, sign-up, passwords, reset, logout, OTP, invitations, members, roles, sessions, cookies, CSRF, rate limits, captcha, the identity module, the sync endpoints' auth, or any unauthenticated endpoint, even if the user only says "add an endpoint" or "fix login".
---

# Poultry platform: authentication and abuse protection

Adapted from the `cdoc-auth` skill (EMSI portal):
- **phone or email + password is the login** ([ADR-015](../../../docs/decisions/ADR-015-password-login.md), 2026-11-24). There is no Entra / Google login. SMS one-time-code login stays in the code, **dormant** until an SMS provider is chosen (`AUTH_SMS_ENABLED`, OQ2).
- **nobody's phone or email is verified.** Owning an identifier never grants access: an invite code does.
- **offline-first sessions.** A worker stays logged in on a farm with no network.
- **SMS cost is an attack surface** (SMS pumping), the day SMS login is turned back on.

Decisions: ADR-005 (sessions, cookie, Better Auth; its login part is superseded), ADR-015 (password login, codes), ADR-006 (tenancy + audit), ADR-007 (law 09-08), ADR-013 (partners). Requirements: SPEC §8 `identity` I1–I5.

## 0. Critical rules (read even if nothing else)

1. **Identity key = `User.id`.**
   - A user has a phone number (E.164, `+2126…` / `+2127…`, through `PhoneNumber`, unique) and/or an email (unique, trimmed, lowercased; the database refuses uppercase). At least one. The phone is preferred: farm workflows use it.
   - A phone-only user keeps Better Auth's placeholder email `<digits>@phone.invalid`. A typed email under `.invalid` is refused.
   - Never merge users.
2. **Authentication ≠ access.** A valid password alone gives nothing:
   - **Owners** may sign up freely (`/signup`). No membership → onboarding creates their organisation.
   - **Managers, workers and partners** get access only with the **one-time invite code** the owner was shown once (`/join` for a new account; onboarding or "Changer d'exploitation" when signed in). A phone number that matches an invitation gives nothing: it is typed, not verified.
   - Every request checks an active `Membership` (user × organisation × role).
3. **Sessions are opaque and server-side** (Postgres `Session` table).
   - No JWT sessions, no tokens in `localStorage` / IndexedDB.
   - Revocation takes effect on the next online request: member removed, role changed (`roleVersion` bump), owner "log out all devices", **a password reset (every session)**.
4. **Cookie:** `__Secure-sid; HttpOnly; Secure; SameSite=Lax; Path=/`, with an explicit expiry. (Better Auth prefixes `__Secure-`, not `__Host-`: ADR-005. The org cookie `__Host-org` is separate.)
   - Never `Strict`: it breaks opening the app from a WhatsApp / SMS link.
   - Chrome and Firefox accept `Secure` on `http://localhost`, so the same name works in dev.
5. **Offline:**
   - The session lasts **30 days, sliding** (renewed on each online request), with an **absolute maximum of 90 days**.
   - The client caches user, memberships and permissions to render offline.
   - **An expired session never deletes the outbox.** Queued mutations wait for the next login, and they are re-checked against the new session's permissions when pushed.
6. **Rate limit on several dimensions at once:** IP, subnet, target identifier (`account`, hashed) or phone, global. One dimension alone is always bypassable. See `references/rate-limiting.md`.
7. **Passwords** (ADR-015): Better Auth's scrypt; 10 to 128 characters; no composition rules (NIST SP 800-63B); refuse a repeated character, a keyboard or digit run, the user's own phone or email (`checkPassword`, `WEAK_PASSWORD`). No common-password list is bundled yet.
8. **One-time codes** (invite and reset): 8 characters from an unambiguous alphabet, stored only as an HMAC (`BETTER_AUTH_SECRET`, purpose-tagged), 7 days, single use, attempts rate-limited, shown once. An invite code is bound to its invitation's organisation and role; a reset code to its user.
9. **Captcha is verified server-side and is single-use:** always on sign-up; after 3 consecutive failures (per identifier or IP) on sign-in and on reset-code use. Never trust a client flag. See `references/captcha.md`.
10. **Uniform failures.** Sign-in: every refusal (unknown account, wrong password, no password, malformed identifier) is `401 errors.INVALID_CREDENTIALS`, and the password is hashed even for an unknown account (Better Auth's `signInEmail`). Reset: every refusal of the code is `401 errors.INVALID_RESET_CODE`. Sign-up is the one accepted exception: `409 ACCOUNT_EXISTS` (no channel to tell the real owner instead; slowed by captcha and limits).
11. **Trust `X-Forwarded-For` only from the configured proxy** (`TRUSTED_PROXY_HOPS`). Otherwise every IP-based limit can be bypassed with one header.
12. **Stop and ask before changing** the cookie name, the session or `BETTER_AUTH_SECRET` (it also keys the codes' HMACs), session lifetimes, the password or code rules, turning SMS login on, the SMS / WhatsApp provider, or the allowed phone prefixes. Each one logs everyone out, breaks login, or changes cost / legal exposure (ADR-007: a provider is a data processor).

## 1. Who logs in how

| Population | Method | Access condition |
|---|---|---|
| Farm owner | Phone or email + password | Self sign-up (`/signup`) → onboarding creates the organisation. Later logins need an active `owner` membership |
| Manager, worker | Phone or email + password | The owner's one-time invite code, at sign-up (`/join`) or signed in; then an active membership |
| Vet, accountant | Phone or email + password | The same invite code (role and end day from the invitation, ADR-013), with the owner's consent |
| Forgot the password | Reset code on `/reset` | From the owner (settings → members; not for owners or members of other farms) or the operator (`pnpm user:reset <phone|email>`) |

Roles: `owner`, `manager`, `worker`, `vet`, `accountant`. The role → action table lives in `src/lib/permissions.ts`, read through `can(ctx, action)`. Never check role names inline.

**Workers never receive** prices, costs, amounts or supplier credit. This is stripped in serializers on the server, not just hidden in the UI.

## 2. Where things live (Next.js)

```
src/modules/identity/
  domain/          PhoneNumber, identifier.ts (phone-or-email parsing, masking, checkPassword) (pure)
  application/     password.ts (signIn, signUp, resetPassword, changePassword, issueResetFor, redeemInvite),
                   members.ts (inviteMember → code, claimInvitation, issueReset, removeMember…),
                   login.ts (dormant SMS requestCode / verifyCode; logout, logoutEverywhere), session.ts, membership.ts
  infrastructure/  better-auth.ts (engine), codes.ts (invite / reset codes: generate, normalise, HMAC),
                   auth-events.ts, sms.ts (smsEnabled(), dormant sender + dev console sink)
  schema.ts        Zod: InviteMember, ResetPassword…
  index.ts
src/lib/
  security/
    rate-limit.ts  consume(policyName, dims) using the policies in policies.ts
    captcha.ts     verifyCaptcha(payload) + single-use store
    csrf.ts        isSameOriginRequest(req) for route handlers
    body.ts        readJson(req) with a 4 KB cap
src/app/api/auth/  sign-in, sign-up, reset-password, logout; request-code, verify-code (404 unless AUTH_SMS_ENABLED)
scripts/reset-password.ts   pnpm user:reset
```

- **One choke point:** `getSession()` turns the cookie into the signed-in user (or null), once per request; `getTenantContext()` adds the membership. Pages, server actions, route handlers and the sync endpoints all use them. Nothing else reads the session cookie.
- **Order in every route handler:** CSRF (state-changing) → body cap → rate limit → captcha (if required) → session → `can()` → validation. The CSRF check and the body cap come first because they cost nothing and spend no counter.
- **Server actions** get Next's built-in Origin vs Host check (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`). They still call `getSession()` / `getTenantContext()` + `can()`, and still validate.

## 3. Sessions

- Better Auth stores the session token in `Session.token` (unhashed, ADR-005 accepted difference); the cookie carries the token plus an HMAC signature.
- **A new session on every login** (session fixation): sign-in, sign-up and reset each open a fresh one through `signInEmail`.
- Lifetimes come from `AUTH_CONFIG`, not code. Our `getSession()` adds the 90-day absolute cap.
- A `roleVersion` or membership mismatch → 401 on the next request, and the client goes to login **without clearing the outbox**.
- Logout:
  - deletes the server row and clears the cookie;
  - **refuses while there are unsynced changes**, unless the user explicitly confirms losing them (`sync.pendingCount > 0`).
- Required features: "log out all my devices" (user), "remove member → revoke sessions" (owner), and a used reset code revokes every session of that user. A password change (« Informations personnelles », the current password first) ends every other session and keeps this one.

## 4. CSRF

`SameSite=Lax` alone is not enough for our JSON route handlers. For every state-changing route handler (POST/PUT/PATCH/DELETE, including `/api/sync/push`):
- reject when `Origin` (or `Referer` when `Origin` is absent) is not exactly `APP_ORIGIN`;
- require the custom header `X-Requested-With: poultry`. The PWA's fetch wrapper sets it. Cross-site forms cannot.

Server actions are covered by Next's own check (§2). Every route file has a row in `src/app/api/routes.int.test.ts`.

## 5. Passwords and one-time codes (ADR-015)

- **Hash:** Better Auth's default scrypt (`@better-auth/utils`: N 16384, r 16, p 1, 64-byte key, 16-byte salt, NFKC). Our sign-up writes the `credential` `Account` row itself (`accountId = userId`) in the same transaction as the user and, with a code, the membership; then `signInEmail` opens the session.
- **Sign-in** resolves the phone or email to the user's email, then calls `auth.api.signInEmail`. Never `signInPhoneNumber`: it answers an unknown number without hashing (timing leak).
- **Invite code:** `inviteMember` returns it once; the `Invitation` row keeps `codeHash`. `claimInvitation(tx, userId, code)` locks the row (`FOR UPDATE`), checks the expiry, upserts the membership with the invitation's role and end day, deletes the invitation. Re-inviting the same number issues a new code; cancelling kills it.
- **Reset code:** `PasswordReset` (one per user, `codeHash`, `issuedById` null for the operator). Using it sets the password, deletes every session and the reset row, in one transaction.
- **An owner may reset** only a non-owner member whose only membership is their organisation (`RESET_NOT_ALLOWED`): otherwise an owner could take over an account that opens other farms.
- Never log a password, a code, a hash, a session id or a full phone number or email. Log the identifier masked: `+2126•••••12`, `k•••@example.ma`.

## 6. SMS one-time-code login: dormant (`AUTH_SMS_ENABLED`)

Off unless `AUTH_SMS_ENABLED=true`. Off: `POST /api/auth/request-code` and `verify-code` answer 404 before reading anything, `/login` offers no code login, `/login/code` sends to `/login`, and the production start check needs no SMS setting (it refuses `true` until a provider is wired). The rules below apply the day it is turned on; nothing in this section runs today.

- 6 digits, valid **5 minutes** (SPEC I1), single use, the challenge destroyed after **5 wrong attempts**, a new request invalidates the previous one. (Better Auth stores the code unhashed: ADR-005 accepted difference.)
- **SMS pumping protection:** only Moroccan mobile numbers (`+2126`, `+2127`) receive codes; a global hourly cap on codes sent, with alerts at 50 % and 100 % (`sms_cap_50`, `sms_cap_100`); a captcha before every code request; a per-number and per-prefix cap. Every code costs money: treat the send endpoint as a payment endpoint.
- The code request always answers `202 {"status":"sent_if_eligible"}`. Verification failures all give `401 INVALID_OR_EXPIRED_CODE`.
- The message contains the code and the app name only. No link. Templates in `ar` and `fr`.
- **Delivery goes through a sender port** (`sendCode` in `sms.ts`). Dev / test: a console sink. **Production refuses the console sink** (`OTP_CONSOLE_SINK` is test only). Production provider: open (OQ2).
- A phone verified by an SMS code (`phoneNumberVerified`) still auto-accepts that number's pending invitations at the code login, and lists them in "Changer d'exploitation" (ADR-013). Password accounts never get this.
- **Before turning it on:** decide what happens to an account whose password was set before its phone was verified (ADR-015 "To review later").

## 7. Audit (ADR-006)

Write an `AuthEvent` for:
- sign-in ok (`login`, reason `password` / `sign_up` / `reset`) and failed (`sign_in_failed`, with the reason, server-side only);
- `sign_up` (reason `owner`, `invite` or `account_exists`);
- `reset_issued` (reason `owner` or `operator`), `reset_used`, `reset_failed`;
- `password_changed` (signed in, with the current password; reason `other_sessions_ended:<n>`), `password_change_failed`;
- `invite_issued`, `invite_accepted`, `invite_failed`;
- logout;
- rate-limit block, captcha failure;
- dormant SMS: code requested (eligible or not), verification failure (reason code).

Organisation-scoped changes stay in `AuditEvent`: invitation created / accepted, member role change or removal, sessions revoked, a reset code issued by the owner (`Membership` / `reset_password`).

Include `userId` when known, the masked identifier, a coarse IP and the user agent. **Never** log passwords, codes, hashes, session ids or captcha payloads.

## 8. Workflow for any auth task

1. Find the existing mechanism in `identity/` and `src/lib/security/`, and extend it. Never create a second auth path.
2. Declare a rate-limit policy (and a captcha mode) for any new unauthenticated or costly endpoint, using the tables in the references. If no policy fits, add one to `policies.ts`. Never put numbers inline.
3. Libraries: Better Auth 1.7.x (engine only, its HTTP handler is not mounted), `altcha-lib` (captcha). Adding a dependency is "ask first" (SPEC §7). Check the installed version's source or docs; don't write library APIs from memory. Pin security libraries to exact versions.
4. Prove each change by sending real requests (`references/test-matrix.md`). Reading the diff is not verification. If a step needs a real SMS provider, say that this step is unverified.

## 9. Checklist

- [ ] Identifier parsed through `parseIdentifier` / `PhoneNumber` / `parseEmail` (+2126 / +2127 only; email lowercased, not `.invalid`)
- [ ] Access needs an active membership or a valid invite code (owners: onboarding). A typed phone never grants access
- [ ] Passwords through `checkPassword`; stored only by Better Auth's hash
- [ ] Codes from `codes.ts`: HMAC stored, 7 days, single use under a row lock, shown once
- [ ] A new session on every login; logout deletes server state and protects unsynced data; a reset revokes every session
- [ ] Cookie flags exactly as §0.4
- [ ] Rate-limit policy declared with at least IP + target (account or phone) + global dimensions
- [ ] Captcha where §0.9 says, verified server-side, single use
- [ ] CSRF check on state-changing route handlers, a row in `routes.int.test.ts`
- [ ] Uniform responses and timing on sign-in and reset
- [ ] Workers' responses contain no money fields (serializer test)
- [ ] Auth events written, nothing secret logged
- [ ] Test matrix executed, results reported

## 10. Anti-patterns to reject

- Granting access because a typed phone number or email matches an invitation (nobody verified it).
- Showing an invite or reset code a second time, storing it in clear, or putting it in a URL.
- Better Auth's `signInPhoneNumber` (timing leak), or a sign-in path that skips hashing for unknown accounts.
- Storing the session token or a password in IndexedDB / `localStorage` for offline use. Cache the **permissions**, not the credential.
- Rate limiting on IP only, or reading `x-forwarded-for` without a trusted proxy.
- Hard-locking a farmer's account after N failures. That lets an attacker lock out a real farmer. Use backoff + captcha + IP/subnet blocks instead.
- Different messages for "unknown account" and "wrong password" (or "wrong code").
- Letting an owner reset the password of another owner or of someone who belongs to other farms.
- (SMS, when on) sending codes to any country code "to be flexible" (SMS pumping).
- Clearing the outbox on logout or on session expiry.
- Hiding money fields only in React for workers.
