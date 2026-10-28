import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision for the precached HTML: a new commit refreshes the shell on every phone.
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || crypto.randomUUID();

const { generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/sw.ts",
  useNativeEsbuild: true,
  additionalPrecacheEntries: ["/ar", "/fr", "/ar/offline", "/fr/offline"].map((url) => ({ url, revision })),
});

// The helper also returns `dynamic`, `dynamicParams` and `revalidate` segment configs, which cacheComponents
// rejects (Serwist 9 targets apps without it).
// ponytail: so the route is dynamic: esbuild bundles the worker on the first request after each server start and
// keeps it in memory. Fine on a long-running server; revisit with the hosting choice (OQ1) or Serwist 10.
export { generateStaticParams, GET };
