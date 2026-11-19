# ADR-001: PWA as the only client

## Status
Accepted

## Date
2026-10-27

## Context
- Users are farm owners, managers and workers, mostly on Android phones. Some are low-end, and connectivity on farms is weak.
- A study by IAV Hassan II (a Moroccan agronomy and veterinary institute) names internet availability as the #1 barrier to farm technology. **Offline data entry is a must-have.**
- The same product also needs a desktop view for owners and, later, accountants.
- The team wants a single codebase and no app-store releases.

## Decision
Build one **Progressive Web App**: responsive Next.js pages, installable, with a service worker (Serwist) and local storage in IndexedDB. There is no native app in v1.

## Alternatives Considered

### React Native (Expo) mobile + web dashboard
- Pros: the strongest offline storage and background sync; native push on iOS.
- Cons: two clients to build and release; app-store friction for farmers.
- Rejected by the product owner in favour of one codebase.

### Flutter (mobile + web)
- Pros: one codebase, good offline and RTL support.
- Cons: Dart instead of TypeScript; Flutter web is weaker for document-like pages (reports, printing).
- Rejected.

## Consequences
- **iOS limits:**
  - no Background Sync API, so on iPhone we sync when the app is opened or brought to the foreground;
  - web push works only once the app is installed (iOS 16.4+);
  - storage can be evicted. We call `navigator.storage.persist()` and **warn when changes are not yet synced**.
- Android Chrome supports background sync and push, so it is the primary target. Interview question Q3 will tell us the iPhone share.
- Installing the app must be guided in the UI, because many users don't know about "Add to home screen".
- If the field data later shows PWA limits hurt adoption, a native wrapper (TWA, Capacitor) can reuse the same web app. That would be a new ADR.
