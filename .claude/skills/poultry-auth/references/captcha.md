# Captcha

## Choice: ALTCHA (self-hosted proof-of-work), candidate

| Option | Why / why not |
|---|---|
| **ALTCHA** (preferred) | Open source and self-hosted. No calls to third parties, no cookies, no tracking. **Fits law 09-08**: no personal data leaves our server, so there is no extra processor in the CNDP file. Works offline-tolerant: the challenge is fetched only when the device is online, which is when the code request happens anyway |
| Cloudflare Turnstile | Good user experience, but sends visitor data to a third party, which is a new processor (ADR-007) |
| reCAPTCHA / hCaptcha | Third-party tracking. Avoid |

Adding `altcha` / `altcha-lib` is "ask first". Pin both to exact versions. Keep the captcha behind a `verifyCaptcha()` function in `src/lib/security/captcha.ts`, so the provider can be swapped.

Proof-of-work costs CPU on the phone. Tune the difficulty (`CAPTCHA_MAX_NUMBER`) on a **low-end Android**: the solve must take under ~1 s there.

## Where it applies

| Mode | Endpoints |
|---|---|
| `always` | `POST /api/auth/request-code` |
| `adaptive` (after 3 consecutive failures, see `rate-limiting.md` §4) | `POST /api/auth/verify-code` |
| `never` | Authenticated routes, sync endpoints |

## Server rules

1. **Our server issues the challenge:** `GET /api/captcha/challenge` returns an HMAC-signed challenge (key `CAPTCHA_HMAC_KEY`), with an expiry of 5 min or less and a random salt.
2. **Verification happens on the server**, before the handler logic: signature, expiry, correct solution (use the installed `altcha-lib` API).
3. **Single use:** store the hash of the challenge as consumed until it expires, and reject replays. The table is created by a Prisma migration, and expired rows are purged.
4. The **difficulty** is configurable, so it can be raised during an attack without a deploy.
5. **Failure** → `400 { ok: false, messageKey: 'errors.CAPTCHA_REQUIRED' }`. It counts as a failure for adaptive escalation.
6. **Never** accept a "captcha passed" flag from the client. `CAPTCHA_DISABLED=true` is allowed in dev / test only. **The app refuses to start with it in production.**

## Frontend

- **One** component, `src/components/captcha-field.tsx`, wraps the widget, fetches the challenge and exposes the payload. Forms never use the widget directly.
- The payload goes in the request body field `captcha`.
- Labelled in **Arabic and French** (`messages/*.json`), keyboard-usable, and correct in RTL.

## What captcha does not replace

A captcha slows bots. It does not stop a determined attacker. The rate limits on all dimensions, the global SMS cost cap, uniform responses and the OTP attempt limits stay mandatory.
