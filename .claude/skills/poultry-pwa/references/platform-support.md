# What each platform supports

Checked October 2026 against the sources in `sources.md`. Re-check before relying on a row for a new feature: support changes with browser releases.

| Capability | Android Chrome | iPhone, Safari tab | iPhone, Home Screen app | Desktop Chrome / Edge | Firefox |
|---|---|---|---|---|---|
| Service worker, Cache API, IndexedDB | ✅ | ✅ | ✅ | ✅ | ✅ |
| Install | ✅ menu or prompt (real app only with Google services, see below) | manual: Share → Add to Home Screen (Safari; also Chrome, Edge, Firefox on iOS 16.4+) | (installed) | ✅ | ❌ on desktop; shortcut only on Android |
| `beforeinstallprompt` (one-tap install button) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Background Sync / Periodic Background Sync | ✅ | ❌ | ❌ | ✅ | ❌ |
| Web Push | ✅ | ❌ | ✅ iOS 16.4+, visible notification required | ✅ | ✅ |
| `storage.persist()` | granted silently by heuristics | heuristics | heuristics; Home Screen counts | heuristics | asks the user |
| Eviction without use | under storage pressure, least-recently-used origin first | **after 7 days without interaction** | not subject to the 7-day rule | storage pressure | storage pressure |
| Manifest changes after install | WebAPK update when the app is opened | n/a | **reinstall needed** | checked at launch, at most every 24 h | n/a |

## Consequences for this app

- **Android Chrome is the primary target** (ADR-001): one-tap install, background sync, push.
- **On iPhone, installing is required, not optional:**
  - it lifts the 7-day eviction, so offline data survives a long absence (SPEC X1);
  - it is the only way to get push (N1).
  The install guide tells iPhone users this.
- **Sync on iPhone** runs when the app opens, on `online`, and on `visibilitychange`. It never runs in the background.
- **Android phones without Google services (many recent Huawei models) do not get a real install:** Chrome and other browsers add a browser-badged home-screen shortcut that opens in the browser (MDN). Samsung Internet on Samsung phones does install. Offline still works through the service worker; check the shortcut path on such a phone during interviews / Checkpoint A (OQ3).
- **Firefox on Android** works offline but has no install prompt and asks before persisting storage. It is not a target; keep it working, nothing more.
