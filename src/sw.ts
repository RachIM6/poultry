/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, RouteMatchCallback, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import { currentScope, localDb } from "./offline/db";
import { BACKGROUND_SYNC_TAG, syncOnce } from "./offline/sync";

// Bundled by src/app/serwist/[path]/route.ts and served at /serwist/sw.js.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY = 24 * 60 * 60;

// Pages and RSC fetches (a tap on a link), not /api/*: a sync pull can take longer than this on 3G.
const isPage: RouteMatchCallback = ({ request, url, sameOrigin }) =>
  sameOrigin && !url.pathname.startsWith("/api/") && (request.mode === "navigate" || request.headers.get("RSC") === "1" || url.searchParams.has("_rsc"));
// SPEC X1: on a connected-but-dead link a page gives up after 5 s and reaches the offline fallbacks below. A failed RSC
// fetch makes Next reload the page; for 10 s after a timeout, page requests get 1 s, so that reload doesn't wait 5 s
// more. Only the 5 s rule opens the window: a slow-but-alive link can't stay stuck on the 1 s rule.
let deadUntil = 0;
const watchLink: SerwistPlugin = { handlerDidRespond: async ({ response }) => void (deadUntil = response ? 0 : Date.now() + 10_000) };

const serwist = new Serwist({
  // Next's static assets plus the public shells (src/app/serwist/[path]/route.ts): offline, sync and the screens that
  // open offline, per locale; not home, which redirects. Served before the rules below.
  precacheEntries: self.__SW_MANIFEST,
  // Three downloads at a time (default 10), so the first install doesn't saturate a 3G link.
  precacheOptions: { concurrency: 3 },
  // poultry-pwa §0.6: a new version waits until the user accepts it (PwaProvider's update banner sends SKIP_WAITING).
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  // Not Serwist's defaultCache: it stores pages, RSC payloads and /api responses network-first, which would keep
  // signed-in data (and sync pulls) in Cache Storage on a shared phone (poultry-pwa §0.2). Only public build files here.
  runtimeCaching: [
    {
      matcher: /\/_next\/static\/.+\.(?:js|css)$/i, // content-hashed
      handler: new CacheFirst({ cacheName: "next-static", plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY })] }),
    },
    {
      matcher: ({ sameOrigin, url }) => sameOrigin && /\.(?:png|svg|ico|webp|woff2?)$/i.test(url.pathname),
      handler: new StaleWhileRevalidate({ cacheName: "static-assets", plugins: [new ExpirationPlugin({ maxEntries: 64 })] }),
    },
    { matcher: (options) => Date.now() < deadUntil && isPage(options), handler: new NetworkOnly({ networkTimeoutSeconds: 1 }) },
    { matcher: isPage, handler: new NetworkOnly({ networkTimeoutSeconds: 5, plugins: [watchLink] }) },
    // Pages, RSC payloads, /api/* and everything else: network only. Offline data lives in IndexedDB (src/offline).
    { matcher: /.*/i, handler: new NetworkOnly() },
  ],
  fallbacks: {
    // A page that isn't a precached shell opens the offline page offline, in the page's language.
    entries: [
      // Aujourd'hui (tasks/plan-ui.md U10): /dashboard is rendered online; offline, its static twin reads the phone.
      {
        url: "/fr/today",
        matcher: ({ request }) => request.destination === "document" && new URL(request.url).pathname === "/fr/dashboard",
      },
      {
        url: "/ar/today",
        matcher: ({ request }) => request.destination === "document" && new URL(request.url).pathname === "/ar/dashboard",
      },
      {
        url: "/fr/offline",
        matcher: ({ request }) => request.destination === "document" && new URL(request.url).pathname.startsWith("/fr"),
      },
      { url: "/ar/offline", matcher: ({ request }) => request.destination === "document" },
    ],
  },
});

serwist.addEventListeners();

// clientsClaim only claims the pages open when the worker activates; PwaProvider asks again for one that was loading.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLAIM") event.waitUntil(self.clients.claim());
});

// Android Background Sync (ADR-003 §6): finish pushing the outbox after the page closed. Only the database of whoever
// signed in last; the server's scope check refuses it if the session cookie now belongs to someone else.
self.addEventListener("sync", (event) => {
  if (event.tag !== BACKGROUND_SYNC_TAG) return;
  event.waitUntil(
    (async () => {
      const scope = await currentScope();
      if (!scope) return;
      // Throwing asks the browser to retry later; give up on answers a retry can't fix.
      if ((await syncOnce(localDb(scope), scope)) === "offline") throw new Error("sync: no network, retry later");
    })(),
  );
});

// SPEC N1: show a push as a notification (browsers require a visible one), and open the inbox when it is tapped.
self.addEventListener("push", (event) => {
  const { title, body, url } = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  if (!title) return;
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? "/ar/inbox";
  event.waitUntil(self.clients.openWindow(url));
});
