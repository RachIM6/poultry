# Multi-dimensional rate limiting

Adapted from `cdoc-auth`. The target is a **phone number**, and every code sent **costs money** (SMS pumping).

## 1. Why several dimensions

Each dimension alone can be bypassed:
- **IP only:** an attacker rotates IPs. Also, rural users often share one carrier NAT IP (3G/4G CGNAT), so strict IP limits hurt real farmers.
- **Phone only:** an attacker sprays many numbers from one IP. That is the core of SMS pumping.
- **Session only:** an attacker drops cookies.

So every sensitive endpoint checks **all** of its dimensions. A request is blocked when **any** limiter is exhausted.

## 2. Dimensions and keys

| Dimension | Key | Purpose |
|---|---|---|
| IP | `ip:<addr>` | Floods from a single source |
| Subnet | `net:<IPv4 /24 or IPv6 /64>` | Distributed attacks from one range |
| Target | `phone:<sha256(E.164)>` | Protects one person's phone (and our SMS bill) from many sources |
| Prefix | `prefix:<+2126/+2127 + next 2 digits>` | Detects pumping on one number range |
| Account | `user:<userId>` | Authenticated abuse |
| Session | `sid:<hash>` | Abuse from one browser |
| Challenge | `otp:<challengeId>` | Brute force on one code (5 attempts, in the domain) |
| Global | `global:<endpoint>` | Circuit breaker on cost. **Alert** when hit |

Phone numbers are hashed in keys, so limiter tables hold no raw personal data (law 09-08).

**Carrier NAT:** mobile carriers put many users behind few IPs. IP limits are therefore set higher than the target and global limits. The target and global dimensions do the real work.

## 3. Policies per endpoint

Defaults, configurable. Policies live in config (`src/lib/security/policies.ts`), never inline in handlers.

| Endpoint | IP | Subnet | Target (phone) | Other | Captcha |
|---|---|---|---|---|---|
| `POST /api/auth/request-code` | 20 / 15 min | 100 / h | **3 / 15 min, 10 / day** (SPEC I1) | prefix 30 / h; **global 300 codes / h** (cost cap, alert at 50 %) | always |
| `POST /api/auth/verify-code` | 60 / h | 200 / h | 10 / h | challenge: 5 attempts total | after 3 failures |
| Invitation create (owner) | — | — | 10 / day per target | user: 50 / day | never (authenticated) |
| `POST /api/sync/push` | — | — | — | session: 120 / min; mutations per request ≤ 500 | never |
| `GET /api/sync/pull` | — | — | — | session: 120 / min | never |
| Authenticated default | — | — | — | session: 300 / min, user: 1000 / min | never |

## 4. Adaptive escalation

Track **consecutive failures** separately from request counts (`fail:<dimension>:<value>`), and reset them on success.

| Consecutive failures (per IP or per target) | Action |
|---|---|
| 1–2 | Normal |
| 3–4 | Captcha required on the next attempt |
| 5–9 | Progressive delay (1 s, 2 s, 4 s … max 30 s) + captcha |
| ≥ 10 | Block the dimension for 15 min, audit event, alert if global |

Never hard-lock the farmer's account itself (see SKILL §9).

## 5. Implementation

- Candidate library: `rate-limiter-flexible`. Adding it is "ask first".
  - Code endpoints use a **Postgres store**, so limits survive restarts and are shared across instances.
  - The authenticated default can use an in-memory store.
- The limiter table is **created by a Prisma migration** matching the installed library version's expected columns. The library must never create tables itself.
- Consume **all** dimensions even after one has failed, so the counters stay accurate.
- Wrap it in `consume(policyName, dims)` in `src/lib/security/rate-limit.ts`. Handlers only name a policy.

## 6. Client IP behind the proxy

- Read the client IP only from the header that **our** proxy overwrites, and only when the request comes from the trusted proxy (configured per environment once hosting is chosen, ADR-007).
- Never trust `X-Forwarded-For` blindly.
- Normalize IPv6 to /64 for the subnet dimension, and IPv4-mapped IPv6 back to IPv4.

## 7. Responses

- **Blocked:** `429` with `Retry-After`, body `{ "ok": false, "messageKey": "errors.TOO_MANY_REQUESTS" }`, the same on every endpoint.
- **Code request blocked on the target or global dimension:** still answer the normal `202` (don't reveal targeting), send no SMS, write an audit event.
- **Every block** writes an audit event. Global-limiter hits raise an alert (possible pumping, or a real surge during onboarding).
