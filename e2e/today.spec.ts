import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, scopeRemembered } from "./auth";

// tasks/plan-ui.md U10: "Aujourd'hui" opens without network, from the phone's database, after one online visit.
test("the home screen works offline with the batch's strip and today's tasks", async ({ page, context }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage Hors Réseau");
  await scopeRemembered(page);
  await farmWithBatch(page, "ross-308", farmDaysAgo(5));
  await page.reload(); // online: the dashboard pulls the batch onto the phone
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached

  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.goto("/fr/dashboard");

  await expect(page).toHaveURL(/\/fr\/(dashboard|today)$/); // the service worker answers /dashboard with /today
  await expect(page.getByRole("img", { name: /Jour 5 de la bande, 4 jour\(s\) non saisi\(s\)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Aujourd’hui" })).toHaveAttribute("aria-current", "page");
});
