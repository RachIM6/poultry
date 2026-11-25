import { expect, test } from "@playwright/test";
import { ownerWithFarm } from "./auth";

// ADR-016: with DEMO_MODE=1, every signed-in page says its data is fictitious; without it, nothing shows. The server
// (playwright.config.ts) inherits the runner's environment, so a run checks the side it was started with:
// `DEMO_MODE=1 pnpm test:e2e e2e/demo-banner.spec.ts` for on, a plain run (CI) for off.
const on = process.env.DEMO_MODE === "1";
const BANNER = { fr: "Démonstration — données fictives uniquement", ar: "عرض توضيحي — بيانات وهمية فقط" };

test(`the demo banner ${on ? "is on every signed-in page" : "is absent"} (DEMO_MODE ${on ? "on" : "off"})`, async ({ page }) => {
  test.setTimeout(60_000); // a login and three pages
  await ownerWithFarm(page, "Ferme de démonstration");
  // A screen of the app shell, the same in Arabic, and a document page outside it.
  for (const [url, text] of [["/fr/batches", BANNER.fr], ["/ar/batches", BANNER.ar], ["/fr/register", BANNER.fr]] as const) {
    await page.goto(url); // waits for the load event: the banner is in the server's HTML or nowhere
    await expect(page.getByRole("status").filter({ hasText: text }), url).toHaveCount(on ? 1 : 0);
  }
});
