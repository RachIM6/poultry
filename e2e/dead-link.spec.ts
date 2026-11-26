import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, scopeRemembered } from "./auth";

// SPEC X1: on a connected-but-dead link (one bar of 3G, a saturated tower), pages and RSC fetches give up after 5 s and
// reach the offline shells (src/sw.ts). /api/* keeps waiting: a sync pull can take longer than that on 3G.
test("on a dead link, the tabs reach their offline shells and a slow sync still lands", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Lent");
  await scopeRemembered(page);
  await farmWithBatch(page, "ross-308", farmDaysAgo(3));
  await page.goto("/fr/batches"); // online, the batch comes onto the phone
  await expect(page.getByRole("img", { name: /Jour 3 de la bande/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // The browser's navigation preload request bypasses context.route, so it would reach the server. Without it the
  // worker fetches the page itself, through the stalled route below, as a dead link would stall the preload.
  await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.navigationPreload.disable()));

  // Every request but /api/* stalls 30 s; /api/* answers after 7 s, past the pages' 5 s timeout.
  await context.route("**", async (route) => {
    const api = new URL(route.request().url()).pathname.startsWith("/api/");
    await new Promise((r) => setTimeout(r, api ? 7_000 : 30_000));
    await route.continue().catch(() => {}); // the page may be gone by then
  });

  // Aujourd'hui: the RSC fetch for /fr/dashboard times out (5 s), Next reloads the page, and the worker answers that
  // reload with the /fr/today shell after 1 s more (not 5): the farm's name, not the dashboard's organisation name.
  // ~6.5-8 s measured on a loaded dev machine; two 5 s waits would take more than 10 s.
  const nav = page.getByRole("navigation");
  let start = Date.now();
  await nav.getByRole("link", { name: "Aujourd’hui" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ferme Atlas" })).toBeVisible({ timeout: 9_000 });
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toBeVisible();
  expect(Date.now() - start).toBeLessThan(9_000);

  // Bandes: the RSC fetch fails, and the full load is the precached /fr/batches shell.
  start = Date.now();
  await nav.getByRole("link", { name: "Bandes", exact: true }).click();
  await expect(page.getByRole("img", { name: /Jour 3 de la bande/ })).toBeVisible({ timeout: 7_000 });
  await expect(page).toHaveURL(/\/fr\/batches$/);
  expect(Date.now() - start).toBeLessThan(7_000);

  // A sync pull slower than 5 s still gets its answer.
  const pull = await page.evaluate(async () => {
    const scope = await new Promise<{ userId: string; organizationId: string }>((resolve) => {
      const req = indexedDB.open("poultry-device");
      req.onsuccess = () => {
        const get = req.result.transaction("session").objectStore("session").get("current");
        get.onsuccess = () => resolve(get.result.scope);
      };
    });
    const began = performance.now();
    const res = await fetch("/api/sync/pull?since=0", { headers: { "x-sync-scope": `${scope.userId}:${scope.organizationId}` } });
    return { status: res.status, ms: performance.now() - began };
  });
  expect(pull.status).toBe(200);
  expect(pull.ms).toBeGreaterThan(6_500);
});
