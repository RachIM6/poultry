import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";

// T25 S3. Without nonces: a nonce needs every page rendered per request, and the offline screens are static shells
// precached by the service worker. So inline scripts and styles stay allowed (Next's RSC payload, React style props),
// but everything else is this origin only: no foreign script, connection, font, frame or plugin.
// shortcut: 'unsafe-inline' scripts, move to hashes (experimental SRI) once it covers Next's inline RSC scripts.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// The service worker's precache revision (src/app/serwist/[path]/route.ts): one per build, inlined below. Set on
// process.env in the build's first process, so the workers it starts inherit it instead of drawing their own. On
// Vercel the deployment's id, the same in the build and in its functions.
process.env.SW_REVISION ||= process.env.VERCEL_DEPLOYMENT_ID || randomUUID();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Always defined, so outside the e2e build "" === "1" folds and src/i18n/strict-messages.tsx ships as a pass-through.
  env: { STRICT_MESSAGES: process.env.STRICT_MESSAGES ?? "", SW_REVISION: process.env.SW_REVISION },
  poweredByHeader: false,
  // T25 security headers. HSTS only means something over HTTPS, which `next start` on localhost ignores.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// next-intl points at src/i18n/request.ts; Serwist keeps esbuild out of the server bundle (it builds src/sw.ts).
// precompile: the ICU messages are compiled at build time, so the screens ship a small formatter instead of the ICU
// parser (about 10 KB gzip off every page, SPEC §9.3).
export default createNextIntlPlugin({
  experimental: { messages: { path: "./messages", format: "json", locales: "infer", precompile: true } },
})(withSerwist(nextConfig));
