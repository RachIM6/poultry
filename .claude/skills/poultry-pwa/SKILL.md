---
name: poultry-pwa
description: Progressive Web App rules for the poultry farm platform (Next.js 16 with cacheComponents, Serwist 9 service worker, per-locale manifests, Arabic RTL + French). Covers the app shell and precaching, runtime caching, what must never be cached, the offline fallback, installability and the install guide, service-worker updates, storage persistence and eviction, iOS limits, background sync and push support, offline UX, and how to prove offline behaviour in tests. Use this skill whenever touching src/sw.ts, the Serwist route, the manifest, icons, the install or offline pages, PwaProvider, caching of any page or API, offline behaviour, "add to home screen", or PWA tests, even if the user only says "make this work offline" or "add a page".
---

# Poultry platform: PWA rules

Decisions: ADR-001 (PWA as the only client), ADR-003 (offline-first sync), ADR-004 (AR/FR, RTL). Requirements: SPEC X1 (offline for at least 7 days), N1 (push).

Written from primary sources only (web.dev, MDN, WebKit, Serwist docs), plus what this repository learned the hard way in T4/T5. Sources, dates and the review of community PWA skills: `references/sources.md`. Rules about pages and data offline in the browser (Dexie, outbox) belong to the sync work (T9) and `poultry-ddd`.

## 0. Critical rules (read even if nothing else)

1. **Offline is the product, not a feature.** A worker opens the app on a farm with no network. Every screen a worker uses must load from the phone after one online visit, and every write must queue (ADR-003). "Works when online" is not done.
2. **Never put personal or signed-in content in a service-worker cache.**
   - Workers share phones. A cached signed-in page shows the last user's data offline, even after logout.
   - Signed-in pages and all `/api/*` responses are `NetworkOnly` in `src/sw.ts`. Offline data lives in IndexedDB (T9), never in Cache Storage.
   - Only **public, static** HTML is precached: `/ar`, `/fr`, `/ar/offline`, `/fr/offline` (and later the static shells of offline screens).
   - Never cache responses that carry `Set-Cookie`, tokens, or anything from another origin.
3. **Pages that must work offline are static shells.** With `cacheComponents`, keep them fully prerendered (○ in the build output) and load user data on the client from IndexedDB. A page that reads cookies or headers is dynamic and cannot be precached.
4. **One manifest per locale**, served at `/{locale}/manifest.webmanifest` (`src/app/[locale]/manifest.webmanifest/route.ts`).
   - `start_url` is `/ar` or `/fr` because the `/` → locale redirect runs on the server and fails offline.
   - `id` is `/`, so one app per user whatever the locale. **Never change `id`**, and avoid changing `start_url`: browsers treat it as a new app (users must reinstall).
   - `lang` and `dir` match the locale. Icons: 192 and 512 PNG, plus a 512 maskable.
   - Installed apps pick up manifest changes late or only after reinstall (iOS: reinstall only). Get names and icons right before the pilot.
5. **The service worker is first-party and self-contained.** Bundle everything into `/serwist/sw.js` from `src/sw.ts`. No `importScripts()` from a CDN: it is a supply-chain risk, and it breaks the first offline install when the CDN is unreachable.
6. **Updates must not mix versions silently.** web.dev advises against `skipWaiting()` without the user's consent: a page loaded with old JS can be served the new worker's assets, and old precached chunks are deleted on activation, which breaks lazy loads offline.
   - Target: the new worker waits; the app shows "New version available, reload" and calls `skipWaiting` when the user agrees, never during a half-filled form.
   - ⚠️ **Current deviation:** `src/sw.ts` sets `skipWaiting: true, clientsClaim: true` (Serwist template). Fix it with the update banner when the sync client lands (T9), before Checkpoint C.
7. **Never reload the page on reconnect.** `PwaProvider` sets `reloadOnOnline={false}`: Serwist's default reload wipes a half-filled daily entry. Reconnecting triggers a sync (T9), not a reload.
8. **Ask for persistent storage and handle full storage.**
   - `navigator.storage.persist()` runs on start (`PwaProvider`). Chrome grants it silently by heuristics (installed, bookmarked, engagement, notification permission); Firefox asks the user; WebKit uses heuristics, and opening as a Home Screen app counts.
   - Every IndexedDB / Cache API write can fail with `QuotaExceededError`: catch it and tell the user. Never lose a queued entry silently.
   - **Safari evicts script-writable storage after 7 days without use, unless the app is installed to the Home Screen.** On iPhone, installing is how the 7-day offline goal (SPEC X1) holds. The install guide says so.
9. **Know what each platform supports** (full table: `references/platform-support.md`).
   - `beforeinstallprompt` (one-tap install): Chromium only. iOS needs the manual Safari steps.
   - Background Sync / Periodic Background Sync: Chromium on Android and desktop only. On iPhone, sync when the app opens, on `online`, and on `visibilitychange`.
   - Web Push: Android anywhere; iPhone only for Home Screen apps (iOS 16.4+), and every push must show a visible notification.
10. **Prove offline behaviour with real offline tests** (recipes: `references/testing.md`).
    - Playwright's `context.setOffline(true)` does **not** stop the service worker's own fetches in Chromium. Also abort every request with `context.route("**", r => r.abort("internetdisconnected"))`, and assert `response.fromServiceWorker()`.
    - Lighthouse 12 removed the PWA / installable audit, and `Page.getInstallabilityErrors` returns `[]` even without a manifest. Use `Page.getAppManifest` (no parse errors) plus a manifest-content test, and check real installation on phones at the checkpoints.
    - The e2e server runs on port 3100 so it never reuses another app on 3000.
11. **Serwist 9 specifics in this repo.**
    - Turbopack integration (`@serwist/turbopack`). Its route helper's `dynamic` / `revalidate` / `dynamicParams` exports are rejected by `cacheComponents`, so `src/app/serwist/[path]/route.ts` exports only `generateStaticParams` and `GET`. The worker is bundled on the first request after each server start, and **that build stalls the whole Node server for about 2–3 s** (measured: a concurrent auth request went from 0.05 s to 2.45 s). Server code must not hold a database transaction open across round trips, or such a stall can time it out. Building the worker at build time instead is the fix to make with the hosting choice (OQ1) or Serwist 10.
    - **Exactly one copy of `serwist` must be installed.** `defaultCache` uses `instanceof Strategy`; with two copies the offline fallback is dropped silently. `pnpm-workspace.yaml` overrides `browserslist` for this. After any dependency change, check the lockfile, not `node_modules/.pnpm` (old folders stay there): `grep -cE "^  serwist@[^:]+\(" pnpm-lock.yaml` must print 1 (one peer-dependency variant).
    - The worker is disabled in `next dev` (`PwaProvider`). Test PWA behaviour on `pnpm build && pnpm start` (launch config `web-prod`, port 3100).
12. **Offline UX follows web.dev's guidelines.** Say what works offline, show the sync status and the pending count, confirm "saved on this phone, will sync", disable only what needs the network, never block the screen with a spinner, and don't rely on colour or the word "offline" alone. Every message exists in `ar.json` and `fr.json`.

## 1. Where things live

```
src/sw.ts                                     the worker: precache, runtime caching, fallbacks
src/app/serwist/[path]/route.ts               builds and serves /serwist/sw.js (revision = git commit)
src/components/pwa-provider.tsx               registration, storage.persist(), no reload on reconnect
src/app/[locale]/manifest.webmanifest/route.ts  per-locale manifest
src/app/[locale]/offline/page.tsx             fallback for pages never opened online
src/app/[locale]/install/page.tsx             install guide (+ src/components/install-guide.tsx)
public/icons/                                 icon.svg (source), 192, 512 (also maskable), apple-touch-icon
e2e/pwa.spec.ts                               offline reload, fallback, manifest, install guide
```

## 2. Workflow for a PWA task

1. Decide where the page or data sits: **static shell** (precache), **public dynamic** (`NetworkFirst`, never personal), or **signed-in** (`NetworkOnly` + data from IndexedDB).
2. If a new static shell must work offline, add its URL to `additionalPrecacheEntries` in the Serwist route, for both locales.
3. If a new page is signed-in, extend the `NetworkOnly` matcher in `src/sw.ts`.
4. Add the strings in both message files. Check RTL at 375 px.
5. Add or extend an e2e test with real offline (rule 10). Run `pnpm test:e2e` on the production build.
6. Run the checklist.

## 3. Checklist

- [ ] Nothing personal, signed-in, cross-origin or `/api/*` is cached by the worker
- [ ] Offline screens are static (○ in `pnpm build`), with data from IndexedDB
- [ ] New offline shells are precached for `ar` and `fr`
- [ ] No `importScripts` or other runtime third-party code in the worker
- [ ] Manifest `id` unchanged; `start_url`, `lang`, `dir` per locale; icons 192/512/maskable reachable
- [ ] No silent reload: not on reconnect, not on update during a form
- [ ] Storage writes handle `QuotaExceededError`
- [ ] iOS path works without `beforeinstallprompt`, Background Sync or push outside the Home Screen
- [ ] Offline e2e aborts all requests and asserts `fromServiceWorker()`
- [ ] One `serwist` copy installed
- [ ] Strings in both locales; RTL checked

## 4. Anti-patterns to reject

- `next-pwa` (unmaintained since 2022) or any webpack-only PWA plugin: this app builds with Turbopack and uses Serwist.
- "Passes the Lighthouse PWA audit" as a goal: the audit no longer exists.
- Caching signed-in pages, API responses or anything carrying cookies "for offline".
- Storing offline data in `localStorage` (synchronous, about 5 MB, strings only, unavailable in workers).
- Loading Workbox or any script from a CDN inside the worker.
- A generic browser error page offline instead of the localized offline page.
- `skipWaiting()` on every deploy without asking (current deviation, rule 6).
- Reloading the page when the network comes back.
- Treating `beforeinstallprompt`, Background Sync or push as available everywhere.
- Testing offline with `setOffline` alone, or only in `next dev` (the worker is disabled there).
