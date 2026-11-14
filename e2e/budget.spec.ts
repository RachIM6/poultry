import { expect, test } from "@playwright/test";

// SPEC §9.3 / T25: the app shell's JS stays ≤ 200 KB compressed. The daily-entry shell had 2.5 KB of margin
// (docs/t25-security-and-performance.md), so a new feature must not quietly push it over. Bodies as served by
// `next start` (gzip), on a first visit (no service worker yet), up to the load event.
const BUDGET_BYTES = 200 * 1024;

for (const path of ["/fr/login", "/fr/batches"]) {
  test(`${path} loads at most 200 KB of compressed JS`, async ({ page }) => {
    const scripts: Promise<number>[] = [];
    page.on("requestfinished", (req) => {
      if (req.resourceType() === "script") scripts.push(req.sizes().then((s) => s.responseBodySize));
    });
    await page.goto(path, { waitUntil: "load" });
    const total = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
    console.log(`${path}: ${(total / 1024).toFixed(1)} KB of JS`);
    expect(total).toBeGreaterThan(50 * 1024); // the sizes really were measured
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });
}
