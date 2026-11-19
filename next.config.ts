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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
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
export default createNextIntlPlugin()(withSerwist(nextConfig));
