# T25: security review and performance budget

Date: 2026-11-10. Branch `feat/t25-security-performance`. Reviewed code: everything up to Checkpoint G (T1–T24).

## 1. Security

How:
- A read-only review of the whole app. It used the `security-and-hardening` checklist and the project's `poultry-auth` rules, and read the Better Auth 1.7.14 source for the OTP flow.
- `pnpm audit` on all dependencies and on production ones only.

### Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | **High** | **A worker could delete or rewrite any stock-ledger movement.** A treatment's id comes from the phone. `recordConsumption` reused any movement already carrying that id: on another item it hard-deleted it, on the same item it overwrote its quantity and day. A worker could send `health.recordTreatment` with a purchase movement's id (every member pulls those ids). The purchase was then replaced by a small consumption, silently breaking the append-only ledger (S3), stock on hand and the locked cost per kg. | **Fixed.** `recordConsumption` now creates movements only, and refuses an id already in the ledger with `ALREADY_EXISTS`. Only a daily entry may replace its own movement (`replace`), because its id is computed from its batch and day. Regression test: `src/modules/health/treatments.int.test.ts` ("S3: a treatment can't take the id of a movement…"). |
| S2 | Medium | **No "log out all my devices".** A lost phone stays signed in for up to 90 days, and nothing can revoke an owner's own sessions. poultry-auth §3 requires this. | **Fixed (2026-11-11):** `logoutEverywhere` ends every session of the user, this one included, and writes an audit event in each of their organisations. "Déconnecter tous mes appareils" on the dashboard, after a confirmation. Tests: `src/modules/identity/login.int.test.ts`, `e2e/login.spec.ts`. |
| S3 | Medium | **No HTTP security headers.** | **Partly fixed:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, and no `X-Powered-By` (`next.config.ts`). **Fixed (2026-11-14):** a Content-Security-Policy without nonces. Nonces need every page rendered per request, and the offline shells are static and precached, so inline scripts and styles stay allowed. Everything else is this origin only: scripts, connections, fonts, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri` and `form-action 'self'`. Tested in `e2e/login.spec.ts`: no violations. |
| S4 | Low | **An oversized number blocks the sender's own outbox.** `z.int()` allows up to 2^53 but the columns are int4. The push throws on the server, and the phone retries that mutation forever, with every later write stuck behind it. It only hurts the sender's own phone. | **Fixed (2026-11-11):** every integer field is `z.int32()`, so a value too big for its column is an `INVALID_INPUT` rejection and the next write goes through. Test: `src/modules/flock/batches.int.test.ts`. |
| S5 | Low | **A role downgrade doesn't clear money already on the phone.** A manager demoted to worker keeps the prices and costs already in their IndexedDB. On a new phone, the old `instrumentDue` notifications come back with amounts. | **Fixed (2026-11-11):** a role change on the phone clears its cached records and pulls again from the start, keeping unsent writes (`rememberScope`, `src/offline/sync.test.ts`). The server no longer sends `instrumentDue` notifications to roles without `money.read` (`notifications.int.test.ts`). |
| S6 | Low | **A daily entry's feed could come from any stock item** (a vaccine or medicine lot), within the same organisation. | **Fixed:** `record-day.ts` passes `of: { kind: "feed" }`. |
| S7 | Low | Dependencies: `pnpm audit --prod` finds nothing. The full audit finds 2 moderate advisories (`glob`, `minimatch`), pulled in only by `@serwist/turbopack` at build time. Also, `@serwist/turbopack` is a devDependency but is imported at run time by `src/app/serwist/[path]/route.ts`, so an install with `--prod` would break the service worker route. | **Fixed (2026-11-11):** moved to `dependencies`. The 2 advisories remain, build time only. |

Known items already scheduled for T26, not new: captcha before code requests; `TRUSTED_PROXY_HOPS`, without which the IP and subnet limits never apply; the alert when the global SMS cap reaches 50 %.

### Checked and clean

- **OTP:**
  - a new code replaces the old one, and the code is consumed atomically;
  - 5 wrong attempts destroy it, and it expires after 5 minutes;
  - per-phone limits allow about 50 guesses a day against 10^6 codes;
  - responses are the same whatever the number (202 / 401);
  - only `+2126`/`+2127` numbers get a code, and the console sink is refused in production.
- **Sessions:**
  - a new session at login (no fixation);
  - the `__Secure-sid` cookie is HttpOnly, Secure, SameSite=Lax;
  - the 90-day cap is enforced;
  - logout deletes the server session and clears local data except unsent work;
  - a role change or removal revokes sessions.
- **CSRF:** a same-origin check plus `X-Requested-With` on every POST route; the pull needs the scope header.
- **Tenant isolation:**
  - every lookup by id in every module is scoped to the caller's organisation;
  - mutation ids from another organisation are refused;
  - pull is filtered by organisation.
- **Roles:** checked again on every mutation at push time. Workers can only record daily entries and weighings, health records, and mark notifications read.
- **Money:** stripped for workers on purchases, batches (including the cost per kg), batch costs, sales and buyer payments.
- **Input:**
  - Zod strips unknown keys;
  - all raw SQL is parameterised;
  - the push body is capped (2 MB, 500 mutations);
  - push endpoints are allow-listed;
  - `CRON_SECRET` is compared in constant time.
- **Service worker:** pages and `/api/*` are network-only; only static shells and hashed assets are precached; sync responses are `no-store`; IndexedDB is per user and organisation.

**Result: no open high-severity finding.**

## 2. Performance

How:
- The production build, run with `next start`.
- Playwright Chromium on the **Pixel 7 profile, emulated**, with:
  - DevTools "Fast 4G" network: 165 ms latency, 9 Mbps down and 1.5 Mbps up, × 0.9;
  - **4× CPU slowdown**.
- 3 runs per case, median, and the whole set run twice.
- **Not measured on a real mid-range Android phone yet, and no Lighthouse report.** The task asks for both, and they need the device.

| Budget | Measured | Result |
|---|---|---|
| App shell JS ≤ 200 KB compressed: `/fr/login` | 157.7 KB gzip | Pass |
| App shell JS ≤ 200 KB compressed: `/fr/batches` (daily entry) | **237.6 KB gzip** | **Fail (+38 KB)** |
| Daily entry interactive < 3 s, cold (no service worker, no cache) | median 1.96 s / 2.16 s | Pass |
| Daily entry interactive < 3 s, warm (service worker installed) | median 0.90 s / 1.39 s | Pass |

Other measurements:
- Cold: LCP 2.15 / 2.43 s (two runs over 2.5 s), total blocking time about 0.7–0.8 s.
- Warm: no script bytes fetched over the network.
- The Turbopack build output no longer prints route sizes, so the JS budget is measured from the network instead of "in the build output" as SPEC §9.3 says.

What makes up `/fr/batches` (gzip):
- react-dom: 70.7 KB;
- Next router runtime: 45.9 KB;
- **zod: 32.2 KB**;
- Dexie: 31.2 KB;
- intl-messageformat: 12.2 KB;
- the domain schemas: 12.0 KB;
- the batch screens: 11.3 KB.

Zod validates nothing on this screen. It comes in only because client code imports constants and domain functions from `src/modules/*/schema.ts` and `src/lib/sync/protocol.ts`, which build their Zod schemas when they load.

What was considered to get under the budget:
1. **Keep Zod off the screens that don't validate.** The zod-free exports (mutation names, `Batch`, `ageOn`, `planFor`, …) move out of the files that build schemas.
2. **Serve brotli** at the host (T26, OQ1). Precompressed, the original `/fr/batches` measured 201.7 KB.
3. Load the day screen's secondary sections lazily.

### After the fix (2026-11-10): options 1 and 3 done

What changed:
- **[ADR-009](decisions/ADR-009-zod-free-shared-files.md), chosen by the product owner:**
  - each module the screens use has a zod-free `shared.ts`, re-exported by `schema.ts`;
  - the screens import values from it and only types from `schema.ts`;
  - the sync request schemas moved into their two routes;
  - ESLint enforces it, and `eslint.boundaries.test.ts` covers it.
- **The batch screen's sections load lazily** with `next/dynamic`: the dashboard, weighings, vaccinations, treatments and visits, sales, and closing. The day's entry form loads with the page. Every chunk is precached by the service worker, so the sections still load offline (the e2e suite checks the offline flows).

Same method, same emulated phone. Sizes are the compressed JS files alone (gzip level 6, as `next start` serves them); in brackets, the transfer measured in the browser including HTTP headers.

| Budget | Before | After | Result |
|---|---|---|---|
| App shell JS ≤ 200 KB: `/fr/login` | 154.1 KB (157.7) | 155.5 KB (159.0) | Pass |
| App shell JS ≤ 200 KB: `/fr/batches` (daily entry) | 232.8 KB (237.6) | **197.5 KB** (202.1) | **Pass, by 2.5 KB** |
| Daily entry interactive < 3 s, cold | 1.96 s | 1.78 s (median of 3) | Pass |
| Daily entry interactive < 3 s, warm | 0.90 s | 1.05 s (median of 3) | Pass |

Other measurements:
- Cold LCP: 1.95 s (was 2.15 s).
- Total blocking time until the form is usable: 358 ms cold (was about 716 ms) and 90 ms warm.
- The lazy sections arrive right after: 25.8 KB in 7 chunks.

The margin is thin: 2.5 KB. Brotli at the host (T26) adds about 15 % more. A size check in CI would stop the next feature from quietly undoing it; that is a follow-up, not done here.

**Result: both budgets are met on the emulated mid-range phone.** A real mid-range Android phone and a Lighthouse report are still owed: they need the device (pilot preparation, T26).
