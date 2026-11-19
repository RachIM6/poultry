# Sources

Primary sources only. Read the relevant one before changing a rule; dates are each page's last update when this skill was written (October 2026).

## Standards and browser vendors

| Topic | Source | Updated |
|---|---|---|
| PWA course and guides (Chrome team) | https://web.dev/explore/progressive-web-apps · https://web.dev/learn/pwa | — |
| Install criteria: `name`/`short_name`, 192 + 512 icons, `start_url`, `display`, HTTPS, engagement; no service worker required | https://web.dev/articles/install-criteria | 2024-09-19 |
| Custom install button (`beforeinstallprompt`) | https://web.dev/articles/customize-install | — |
| Updates: waiting worker, why `skipWaiting()` is discouraged, update UX, manifest updates | https://web.dev/learn/pwa/update | 2022-03-10 |
| Storage: IndexedDB / Cache API, quotas, eviction, Safari 7-day rule, `QuotaExceededError` | https://web.dev/articles/storage-for-the-web | 2024-09-23 |
| `navigator.storage.persist()` grant behaviour | https://web.dev/articles/persistent-storage | 2020-05-12 |
| Offline UX guidelines | https://web.dev/articles/offline-ux-design-guidelines | — |
| Offline fallback page | https://web.dev/articles/offline-fallback-page | — |
| Quotas and eviction (current numbers) | https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | — |
| Web app manifest | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest · https://www.w3.org/TR/appmanifest/ | — |
| Which browsers install PWAs (WebAPK only with Google services; iOS 16.4+ Share menu in all browsers; no Firefox desktop) | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable | — |
| iOS Web Push for Home Screen apps (16.4) | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ | — |
| WebKit storage policy (persist heuristics, Home Screen apps) | https://webkit.org/blog/14403/updates-to-storage-policy/ | — |
| Badging for Home Screen apps | https://webkit.org/blog/14112/badging-for-home-screen-web-apps/ | — |
| Declarative Web Push (iOS 18.4) | https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ | — |

## Libraries and tools

| Tool | Source | Note |
|---|---|---|
| Serwist (service worker, Turbopack integration) | https://serwist.pages.dev/docs/next/turbo | Pinned 9.5.13. Version 9 has no `cacheComponents` route helper (rule 11) |
| Playwright service workers | https://playwright.dev/docs/service-workers | `context.route` sees the worker's requests |
| Chrome DevTools MCP (Google, installed) | https://github.com/ChromeDevTools/chrome-devtools-mcp | Live debugging of workers, caches, offline |
| Chrome "modern-web-guidance" (Google) | https://github.com/GoogleChrome/modern-web-guidance | Official and safe (Apache-2.0, signed npm provenance), but only one PWA guide (origin migration), and it runs `npx -y …@latest`. Not installed; read its guides directly if useful |
| Microsoft PWABuilder / PWA Studio | https://www.pwabuilder.com | Store packaging (TWA, Microsoft Store). Not needed while ADR-001 rules out stores |

## Community PWA skills reviewed on 2026-10-28 (not used)

All five are Markdown only, with no scripts or hooks. None is by a recognized expert, and none covers Serwist, `cacheComponents`, iOS eviction or RTL.

| Skill | Verdict |
|---|---|
| claude-dev-suite `pwa` (MIT) | Safe, short Workbox checklist; targets the removed Lighthouse PWA audit |
| alinaqi/claude-bootstrap `pwa-development` (MIT) | Recommends `next-pwa` (unmaintained since 2022) and the Lighthouse PWA audit |
| curiositech `pwa-expert` (MIT) | Recommends `next-pwa`; grants the agent shell access it doesn't need |
| secondsky `progressive-web-app` (MIT) | Too thin; placeholder author metadata |
| nimoqup046-collab/agora `progressive-web-app` | **No licence** (not reusable); loads Workbox from a CDN inside the worker |
