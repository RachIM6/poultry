import { cacheLife } from "next/cache";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision for the precached HTML: one id per build (next.config.ts: SW_REVISION, Vercel's deployment id or a random
// one, inlined at build time), so a new build refreshes the shells on every phone and a restart or a cold start doesn't.
// Not .next/BUILD_ID: Next writes it after the build workers have loaded this module, so they read a missing file or the
// previous build's. The fallback is for `next dev`, where Serwist drops these entries.
const revision = process.env.SW_REVISION || "unbuilt";

const serwist = createSerwistRoute({
  swSrc: "src/sw.ts",
  useNativeEsbuild: true,
  // Serwist's defaults, plus the font files next/font preloads (the ".p." ones), so the first offline launch has fonts.
  globPatterns: [".next/static/**/*.{js,css,html,ico,apng,png,avif,jpg,jpeg,jfif,pjpeg,pjp,gif,svg,webp,json,webmanifest}", ".next/static/media/*.p.*.woff2", "public/**/*"],
  // Public, static shells only (poultry-pwa §0.3). /sync reads the signed-in user's data from IndexedDB, not the HTML.
  additionalPrecacheEntries: ["", "/offline", "/sync", "/farms", "/batches", "/protocol", "/inbox", "/stock", "/eggs", "/compare", "/receivables", "/origin", "/expenses", "/today", "/staff", "/tasks", "/climate/targets", "/climate", "/prices", "/planning", "/visitors", "/disposal", "/cleanout", "/documents", "/register", "/inspection"].flatMap((path) => ["ar", "fr"].map((l) => ({ url: `/${l}${path}`, revision }))),
});

// The helper also returns `dynamic`, `dynamicParams` and `revalidate` segment configs, which cacheComponents
// rejects (Serwist 9 targets apps without it). Its GET bundles the worker with esbuild on a cold call: I/O that stops a
// cacheComponents prerender, so whether `next build` made sw.js static depended on which build worker served it. Cached,
// the bundle is always part of the prerender, and the worker is served as a static file: a Vercel function couldn't
// bundle it (no src/, no esbuild, no .next/static in it).
// ponytail: "max" regenerates after 30 days without a deploy, which fails on Vercel and keeps serving the built file;
// only devtools' sw.js.map is ever asked of the function. Revisit with Serwist 10.
async function bundled(path: string) {
  "use cache";
  cacheLife("max");
  const res = await serwist.GET(new Request("http://localhost/"), { params: Promise.resolve({ path }) });
  return { body: await res.text(), type: res.headers.get("content-type") ?? "text/plain" };
}

export const { generateStaticParams } = serwist;

export async function GET(_: Request, { params }: { params: Promise<{ path: string }> }) {
  const { body, type } = await bundled((await params).path);
  return new Response(body, { headers: { "Content-Type": type, "Service-Worker-Allowed": "/" } });
}
