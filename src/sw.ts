/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
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

const serwist = new Serwist({
  // Next's static assets plus the public shells: home, offline and sync pages per locale. Served before the rules below.
  precacheEntries: self.__SW_MANIFEST,
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
    // Pages, RSC payloads, /api/* and everything else: network only. Offline data lives in IndexedDB (src/offline).
    { matcher: /.*/i, handler: new NetworkOnly() },
  ],
  fallbacks: {
    // A page that isn't a precached shell opens the offline page offline, in the page's language.
    entries: [
      {
        url: "/fr/offline",
        matcher: ({ request }) => request.destination === "document" && new URL(request.url).pathname.startsWith("/fr"),
      },
      { url: "/ar/offline", matcher: ({ request }) => request.destination === "document" },
    ],
  },
});

serwist.addEventListeners();

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
