/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

// Bundled by src/app/serwist/[path]/route.ts and served at /serwist/sw.js.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // Next's static assets plus the locale home pages and offline pages (the app shell).
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Signed-in pages are never stored: on a shared phone they would show the last user's data offline.
    { matcher: ({ url }) => /^\/(ar|fr)\/account/.test(url.pathname), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: {
    // A page that was never visited while online opens the offline page, in the page's language.
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
