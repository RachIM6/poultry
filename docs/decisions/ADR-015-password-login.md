# ADR-015: Password login (phone or email), one-time invite and reset codes, SMS login off by a setting

## Status
Accepted (decided by the product owner on 2026-11-24; details to review). Supersedes the login part of [ADR-005](ADR-005-phone-otp-auth.md): the identifier and the one-time SMS code. ADR-005's sessions, cookie, offline rules, Better Auth as the engine, rate limiting and captcha stay. Amends [ADR-013](ADR-013-partner-access.md): an invitation is accepted with its code, not by a verified phone that matches.

## Date
2026-11-24

## Context
- No SMS provider is chosen (SPEC OQ2), and the production build refuses to print codes to the console. So nobody can log in to production, and the pilot is blocked on a vendor choice.
- Farmers and workers all have a mobile number; some partners (an accountant) prefer an email. Farm workflows use the phone (a worker is linked to an employee by phone, SPEC-m4 WF2).
- Without SMS or email, nothing proves that a person owns the phone number or email they type. ADR-005 and ADR-013 gave access on the strength of a verified phone (an invitation for that number was accepted at the first code login). That reasoning no longer holds.

## Decision

### Identity
- A user has a **phone number** (E.164, Moroccan mobile `+2126` / `+2127` through `PhoneNumber`, unique) and/or an **email** (unique, trimmed and lowercased; the database refuses a non-lowercase value). At least one is required. The phone is strongly preferred: the sign-up form asks for it first and the farm workflows use it.
- Better Auth requires an email on every user. A phone-only user keeps the existing placeholder `<digits>@phone.invalid`; a typed email under `.invalid` is refused, so nobody can claim a placeholder.
- **Sign-in** is with the phone or the email, plus the password (`POST /api/auth/sign-in`). The identifier is resolved to the user's email by our code, then Better Auth's `signInEmail` checks the password and opens the session. We don't use the phone-number plugin's `signInPhoneNumber`: in Better Auth 1.7.25 it answers an unknown number without hashing, so its timing says whether the number has an account. `signInEmail` hashes the password for an unknown or password-less account too.

### Passwords
- Hashed by **Better Auth's default: scrypt** (`@better-auth/utils` 0.5.1, node:crypto, N = 16384, r = 16, p = 1, 64-byte key, 16-byte random salt, NFKC-normalised). No pepper: the hash is Better Auth's own format.
- **10 to 128 characters**, no composition rules (NIST SP 800-63B).
- **The 1,000 most common passwords are not checked.** There is no such list in the repository or in an installed dependency, and fetching one is a download we don't make on our own. Instead, a small context check (NIST "context-specific words"): a password that is a single repeated character, a run of keyboard or digit sequence such as `1234567890` / `azertyuiop`, the user's own phone number (any spelling) or email, is refused with `WEAK_PASSWORD`. A real list (for example SecLists' top 10 000 filtered to ≥ 10 characters) can be bundled later as a plain text file.
- The confirmation field is checked on the phone (`PASSWORDS_DIFFER`); the server checks the policy.

### Unverified identifiers: ownership never grants access
- **Owners sign up on their own** (`POST /api/auth/sign-up`, captcha always) and onboard a new organisation. That is acceptable: they reach only the organisation they create.
- Sign-up **says when a phone or email already has an account** (`409 ACCOUNT_EXISTS`). Without SMS or email there is no channel to tell the real owner instead, so this enumeration is accepted and slowed by the captcha and the sign-up limits.
- **Invitations (members and partners) are accepted only with a one-time invite code:**
  - 8 characters from an unambiguous 31-character alphabet (no `0 O 1 I L`), about 40 bits, from `crypto.randomInt`;
  - stored only as an HMAC-SHA256 (key `BETTER_AUTH_SECRET`, purpose-tagged), so a database read alone doesn't reveal or brute-force it offline;
  - expires after 7 days (the invitation's existing expiry), single use (the invitation row is deleted under a row lock when it is accepted);
  - attempts rate-limited (`inviteCode` policy: IP, subnet, signed-in user, global);
  - **bound to the invitation's organisation and role:** the code is looked up, never typed next to an organisation, so it can only open the organisation and role it was issued for. Inviting the same number again issues a new code and kills the old one; cancelling the invitation kills it too.
  - The owner sees the code **once**, when inviting, and hands it over in person or by WhatsApp. The phone number on the invitation is now only a label for the owner.
  - It is accepted either while creating an account (`/join`: the code plus the new account's identifiers and password) or by a signed-in user (onboarding, or "Changer d'exploitation").
- An invited number that signs up without the code gets **no access** to the inviting organisation: it onboards like any new owner.

### Password reset without SMS or email
- **By the owner**, in settings → members: "Réinitialiser le mot de passe" shows a one-time **reset code** once, with the same properties as the invite code (8 characters, HMAC-stored, 7 days, single use, attempts limited). One pending code per user: a new one replaces the previous. The member enters it on `/reset` with their phone or email and a new password.
  - Allowed only for a member who is not an owner and whose only membership is this organisation (`RESET_NOT_ALLOWED` otherwise). An owner of one farm must not be able to take over a vet's or another owner's account and with it their other farms.
  - Accepted risk: the owner who hands over the code could use it themselves and act as that worker. The owner can already remove or demote the member; the audit shows who issued the code.
- **By the operator:** `pnpm user:reset <phone|email>` prints a reset code for anyone, owners included. Audited (`AuthEvent reset_issued`, reason `operator`).
- **Using a reset code** sets the password and **revokes all the user's sessions**, then opens a new one on that phone. Every failure (unknown account, wrong, expired or used code) is the same `401 INVALID_RESET_CODE`.

### Abuse
Policies in `src/lib/security/policies.ts`; the identifier dimension (`account`) is hashed like the phone, so the limiter table holds no personal data.
- **Sign-in:** IP 30 / 15 min and subnet 150 / h (counted first, only with `TRUSTED_PROXY_HOPS`), then per identifier 10 / h and 50 / day, and global 3 000 / h. A global hit writes an `alertOps` line.
- **Adaptive captcha:** from the 3rd consecutive failure per identifier or per IP (`signInFailures`, reset by a success), a solved, unused captcha is required, checked before the identifier's budget, as `verify-code` does. The account is never hard-locked; the identifier budget is the slow-down.
- **Sign-up:** captcha always; IP 10 / h, subnet 50 / h, global 300 / h.
- **Reset code use:** the sign-in pattern (IP, subnet, per identifier 10 / h, global 500 / h, adaptive captcha after 3 failures).
- **Uniform responses:** `401 errors.INVALID_CREDENTIALS` ("wrong phone/email or password") for an unknown account, a wrong password, an account with no password and an invalid identifier. Constant-ish timing: Better Auth hashes the password when the account doesn't exist.
- **AuthEvent** (poultry-auth §6) for: sign-in ok (`login`, reason `password`) and failed (`sign_in_failed`, with the reason, server-side only), `sign_up`, `reset_issued`, `reset_used`, `reset_failed`, `invite_issued`, `invite_accepted`, `invite_failed`, plus the existing `rate_limited` and `captcha_failed`. The `phone` column keeps the masked identifier (`+2126•••••12` or `a•••@example.ma`). Never a password, code, hash or session id.
- Route handlers keep CSRF (`isSameOriginRequest`) and the 4 KB body cap; server actions keep Next's Origin check.

### SMS login: off by a setting
- `AUTH_SMS_ENABLED` (default false; only `true` turns it on).
- **When false:** `POST /api/auth/request-code` and `POST /api/auth/verify-code` answer `404` before reading anything; `/login` offers no code login and `/login/code` is a 404; the production start check needs no SMS setting.
- **When true:** today's flow works unchanged (`/login/code`), for later. A verified phone still auto-accepts that number's pending invitations at the code login, and a signed-in user with a verified phone still sees them in "Changer d'exploitation", as in ADR-013. Users who signed up with a password have `phoneNumberVerified = false`, so they never get this.
- The production start check refuses `AUTH_SMS_ENABLED=true` until a provider exists, except on the e2e test server (where `OTP_CONSOLE_SINK` prints codes). It still refuses `OTP_CONSOLE_SINK` in production.
- **Dormant while off:** `OTP_CONSOLE_SINK`, the `requestCode` / `verifyCode` / `verifyFailures` policies, the SMS-cost cap and its `sms_cap_50` / `sms_cap_100` alerts, the code-request captcha, and `src/modules/identity/infrastructure/sms.ts`.

## Alternatives Considered
- **Keep SMS and choose a vendor now:** the right end state, but it blocks the pilot on a contract and a CNDP processor filing (ADR-007).
- **Phone + password where the phone is trusted for invitations:** anyone could sign up with a worker's number before the worker and inherit the invitation. Rejected: ownership of an identifier must never grant access.
- **Better Auth's `signInPhoneNumber`:** leaks account existence by timing (above).
- **Email-only password login (Better Auth's default shape):** most farmers have no email they read.
- **Invite links instead of codes:** a link carries the secret in a URL (history, previews, link scanners prefetching it). A short code read aloud or sent by WhatsApp suits the users.

## Consequences
- The pilot can log in without an SMS vendor. T26 no longer waits on OQ2 for login.
- Every pending invitation created before this change has no code; the owner invites again to get one.
- Rotating `BETTER_AUTH_SECRET` now also kills pending invite and reset codes (they are HMAC-keyed with it), on top of logging everyone out.
- A squatted identifier (someone signs up first with a worker's phone) is a support case: the worker signs up with an email or another number, or the operator frees the number.
- Passwords on shared phones are a risk ADR-005 named; the browser must not save them on a shared phone. The login form uses `autocomplete="current-password"`, so a browser offers to save it; workers on a shared phone should decline.

## To review later
- **An email provider** for self-service reset (and email verification), replacing owner and operator resets for those who have an email.
- **Re-enabling SMS** (OQ2): phone verification at sign-up, SMS reset, and what happens to an account whose password was set before its phone was verified (a phone owner verifying by SMS lands in an account someone else set a password on: revoke that password then).
- **Two-factor authentication for owners** (they hold the money and the members).
- The common-password list (above), and whether 7 days is too long for a reset code.
