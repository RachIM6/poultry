import { readFileSync } from "node:fs";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision for the precached HTML: Next's id for this build, so a new build refreshes the shells on every phone and a
// restart doesn't. `next start` refuses to run without .next/BUILD_ID, so the fallback is only seen while `next build`
// runs (the file is written at its end; this route is dynamic, nothing built then is served) and in `next dev`, where
// Serwist drops these entries. Never random: a random id would re-download every shell after each restart.
const revision = (() => {
  try {
    return readFileSync(".next/BUILD_ID", "utf8").trim();
  } catch {
    return "unbuilt";
  }
})();

const { generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/sw.ts",
  useNativeEsbuild: true,
  // Serwist's defaults, plus the font files next/font preloads (the ".p." ones), so the first offline launch has fonts.
  globPatterns: [".next/static/**/*.{js,css,html,ico,apng,png,avif,jpg,jpeg,jfif,pjpeg,pjp,gif,svg,webp,json,webmanifest}", ".next/static/media/*.p.*.woff2", "public/**/*"],
  // Public, static shells only (poultry-pwa §0.3). /sync reads the signed-in user's data from IndexedDB, not the HTML.
  additionalPrecacheEntries: ["", "/offline", "/sync", "/farms", "/batches", "/protocol", "/inbox", "/stock", "/eggs", "/compare", "/receivables", "/origin", "/expenses", "/today", "/staff", "/tasks", "/climate/targets", "/climate", "/prices", "/planning", "/visitors", "/disposal", "/cleanout", "/documents", "/register", "/inspection"].flatMap((path) => ["ar", "fr"].map((l) => ({ url: `/${l}${path}`, revision }))),
});

// The helper also returns `dynamic`, `dynamicParams` and `revalidate` segment configs, which cacheComponents
// rejects (Serwist 9 targets apps without it).
// ponytail: so the route is dynamic: esbuild bundles the worker on the first request after each server start and
// keeps it in memory. Fine on a long-running server; revisit with the hosting choice (OQ1) or Serwist 10.
export { generateStaticParams, GET };
