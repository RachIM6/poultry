# Auth test matrix

Run these as **real HTTP requests** in Vitest integration tests (`*.int.test.ts`) against the Next route handlers, on the test Postgres database, with the console SMS sink capturing the codes. Check the cookie flags once more in a Playwright run. Report each result. A step that needs the real SMS / WhatsApp provider is marked unverified until staging.

## Phone numbers

- [ ] `0612345678`, `+212612345678`, `00212612345678`, `06 12 34 56 78` → the same user (`+212612345678`)
- [ ] `+33…`, `05…` (landline), `+2128…` → rejected **with the same `202` as an eligible number**, and no SMS sent

## Sessions and cookies

- [ ] Login sets `__Host-sid` with `HttpOnly; Secure; SameSite=Lax; Path=/` and an expiry
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

## OTP

- [ ] Unknown number and known number → identical status, body and similar timing
- [ ] Wrong code → generic 401. The 5th wrong code destroys the challenge, and the correct code afterwards fails
- [ ] Reusing a code after success → fails
- [ ] Code expired after 5 min → the same generic 401
- [ ] A new request invalidates the previous code
- [ ] The app refuses to start with the console sink in production

## Rate limiting and cost

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
