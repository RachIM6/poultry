// Startup guard (src/instrumentation.ts): production refuses to start on an unsafe or incomplete configuration.
// Messages name the variable, never its value. Returns the warnings (risky but allowed settings) for the caller to log.
const PLACEHOLDER = "dev-only-replace-me-with-32-random-bytes"; // .env.example's value for both secrets

export function checkProductionEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // CI's e2e server is a production build on http://localhost that prints login codes (playwright.config.ts). This one
  // escape allows exactly that, and only with CI also set, so a production .env that copies the flag still refuses.
  if (env.ALLOW_TEST_SERVER_IN_CI && !env.CI) errors.push("ALLOW_TEST_SERVER_IN_CI is only accepted when CI is set.");
  const testServer = env.ALLOW_TEST_SERVER_IN_CI === "1" && !!env.CI;

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is required.");

  // The exact origin: CSRF compares it with the Origin header (src/lib/security/csrf.ts), so no path or trailing slash.
  const origin = URL.parse(env.APP_ORIGIN ?? "");
  const https = origin?.protocol === "https:";
  const loopback = origin?.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (!origin || origin.origin !== env.APP_ORIGIN || !(https || (testServer && loopback))) {
    errors.push("APP_ORIGIN must be the site's https:// origin (scheme and host only).");
  }

  for (const name of ["BETTER_AUTH_SECRET", "CAPTCHA_HMAC_KEY"]) {
    const value = env[name];
    if (!value || value === PLACEHOLDER || value.length < 32) {
      errors.push(`${name} must be a random string of at least 32 characters, not the .env.example placeholder.`);
    }
  }
  if (env.CAPTCHA_DISABLED === "true") errors.push("CAPTCHA_DISABLED=true is refused in production.");

  // Must be a decision for the host, even 0: a wrong count lets one X-Forwarded-For header bypass the IP limits.
  if (env.TRUSTED_PROXY_HOPS === undefined || env.TRUSTED_PROXY_HOPS === "") {
    errors.push("TRUSTED_PROXY_HOPS must be set: the number of proxies in front of the app (0 if none).");
  } else if (env.TRUSTED_PROXY_HOPS === "0") {
    warnings.push("TRUSTED_PROXY_HOPS=0: the per-IP and per-subnet rate limits do not apply.");
  }

  // Both keys or neither (push off). Keys without a subject would also leave push silently off.
  if (!!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY !== !!env.VAPID_PRIVATE_KEY) {
    errors.push("NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together, or both left empty.");
  } else if (env.VAPID_PRIVATE_KEY && !env.VAPID_SUBJECT) {
    errors.push("VAPID_SUBJECT is required with the VAPID keys.");
  }

  if (env.OTP_CONSOLE_SINK && !testServer) errors.push("OTP_CONSOLE_SINK is test only: it prints login codes to the log.");
  if (!env.CRON_SECRET) warnings.push("CRON_SECRET is not set: POST /api/push/dispatch is off: no reminders, pushes or postings catch-up.");

  if (errors.length > 0) throw new Error(`Refusing to start in production:\n- ${errors.join("\n- ")}`);
  return warnings;
}
