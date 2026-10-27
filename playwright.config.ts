import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Own port, so a dev server (or another project) on 3000 is never reused by mistake.
  use: { baseURL: "http://localhost:3100" },
  // Farm users are on phones: test the mobile viewport first (SPEC §6).
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm build && pnpm start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
