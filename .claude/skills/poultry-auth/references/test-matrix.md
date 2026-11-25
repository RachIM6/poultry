# Auth test matrix

Run these as **real HTTP requests** in Vitest integration tests (`*.int.test.ts`) against the Next route handlers, on the test Postgres database (password login: `src/modules/identity/password.int.test.ts`; dormant SMS login, with `AUTH_SMS_ENABLED` stubbed on and the console sink capturing the codes: `captcha.int.test.ts`, `auth-events.int.test.ts`). Check the cookie flags once more in a Playwright run. Report each result. A step that needs the real SMS / WhatsApp provider is marked unverified until staging.

## Password login (ADR-015)

- [ ] Sign-up with a phone, with an email, with both; sign-in with either, any phone spelling, any email case
- [ ] A taken phone or email → `409 ACCOUNT_EXISTS`, nobody created; a weak, short or long password → 400 with its code
- [ ] Wrong password, unknown account, malformed identifier → identical `401 INVALID_CREDENTIALS`, similar timing, a `sign_in_failed` event each
- [ ] 3 failures per identifier or IP → captcha required, checked before the identifier's budget; a success resets the count
- [ ] Identifier budget, IP / subnet (with a trusted proxy) and global limits → 429 `TOO_MANY_REQUESTS`
- [ ] Sign-up without a solved captcha → 400 `CAPTCHA_REQUIRED`

## Invite and reset codes

- [ ] An invite code joins its organisation with its role and end day, once; stored only as an HMAC
- [ ] Expired, re-issued, cancelled or reused code → `INVALID_INVITE_CODE`, and a refused code at sign-up creates no account
- [ ] An invited number signing up without the code → onboarding, no access to the inviting organisation, no invitation listed
- [ ] Code attempts limited per user and per IP
- [ ] An owner's reset code sets the password once, revokes every session, opens a new one; refused for owners and members of other farms
- [ ] Every refusal of a reset code → identical `401 INVALID_RESET_CODE`
- [ ] `pnpm user:reset` issues a code for anyone, audited
- [ ] SMS endpoints → 404 with `AUTH_SMS_ENABLED` off, today's flow with it on

## Phone numbers

- [ ] `0612345678`, `+212612345678`, `00212612345678`, `06 12 34 56 78` → the same user (`+212612345678`)
- [ ] `+33…`, `05…` (landline), `+2128…` → rejected **with the same `202` as an eligible number**, and no SMS sent

## Sessions and cookies

- [ ] Login sets `__Secure-sid` with `HttpOnly; Secure; SameSite=Lax; Path=/` and an expiry
- [ ] The session id differs before and after login. The database stores only its hash
- [ ] Logout → the old cookie gets 401
- [ ] Logout with unsynced changes → refused unless confirmed (e2e)
- [ ] Owner removes a member → that member's next request gets 401
- [ ] Role change → `roleVersion` mismatch → 401 on the next request
- [ ] Sliding 30-day and absolute 90-day expiry enforced (fixed clock)
- [ ] An expired session while offline keeps the outbox. After login, the queued mutations push and are re-checked against the new permissions (e2e)

## Access

- [ ] A new number with no invitation → onboarding as owner (creates an organisation)
- [ ] An invited number → joins the inviting organisation with the invited role, and **does not** create an organisation
- [ ] An expired or revoked invitation → treated as a new owner sign-up, not as access to the inviting organisation
- [ ] A worker's responses (batches, stock, sales, sync pull) contain no price, cost, amount or credit fields

## OTP (dormant: `AUTH_SMS_ENABLED`)

- [ ] Unknown number and known number → identical status, body and similar timing
- [ ] Wrong code → generic 401. The 5th wrong code destroys the challenge, and the correct code afterwards fails
- [ ] Reusing a code after success → fails
- [ ] Code expired after 5 min → the same generic 401
- [ ] A new request invalidates the previous code
- [ ] The app refuses to start with the console sink in production

## Rate limiting and cost (SMS, dormant)

- [ ] 4th code request for the same number within 15 min → still `202`, no SMS, audit event
- [ ] Many IPs, one number → the target limit triggers
- [ ] One IP, many numbers → the IP / prefix limits trigger
- [ ] Global hourly cap reached → no more SMS, alert emitted, responses unchanged
- [ ] A forged `X-Forwarded-For` from outside the trusted proxy is ignored
- [ ] Consecutive failures → captcha required → backoff → temporary block. The real account is never hard-locked

## Captcha

- [ ] Missing captcha on a code request → 400 `CAPTCHA_REQUIRED`
- [ ] Replayed, expired or tampered challenge → rejected
- [ ] App refuses to start with `CAPTCHA_DISABLED=true` in production
- [ ] Solve time on a low-end Android ≤ ~1 s (manual)

## CSRF

- [ ] `POST /api/sync/push` with a foreign `Origin` → 403
- [ ] `POST` without `X-Requested-With: poultry` → 403

## Audit

- [ ] Each event in SKILL §6 is written with the masked phone, coarse IP and user agent
- [ ] Logs contain no codes, hashes, session ids, captcha payloads or full phone numbers
