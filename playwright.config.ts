import { defineConfig, devices } from "@playwright/test";

// Local .env for DATABASE_URL (tests read one-time codes from it); CI sets real env vars instead.
try {
  process.loadEnvFile();
} catch {}

// E2E_PORT: parallel sessions (one worktree each) run their own server; a reused server would test another branch.
const port = process.env.E2E_PORT ?? "3100";
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  // Own port, so a dev server (or another project) on 3000 is never reused by mistake.
  use: { baseURL: origin, trace: "retain-on-failure" },
  // Login → dashboard → onboarding is three server round trips, each checking the session. With 4 workers on one
  // production server they took just over the 5 s default in two of three full runs during T9 (never when run alone).
  expect: { timeout: 10_000 },
  // CI uploads playwright-report/ and test-results/ when a test fails (.github/workflows/ci.yml).
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  forbidOnly: !!process.env.CI,
  // Farm users are on phones: test the mobile viewport first (SPEC §6).
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${port}`,
    // OTP_CONSOLE_SINK lets the production build "send" codes without an SMS provider (tests read them from the DB).
    env: { APP_ORIGIN: origin, OTP_CONSOLE_SINK: "1" },
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
