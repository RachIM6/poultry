import { expect, test, type Page } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, query, referenceCached, scopeRemembered } from "./auth";

// Checkpoint E (tasks/todo.md): 10 simulated days of a batch, entered offline, with the dashboard's KPIs equal to the
// hand calculation below; then online, each day reaches the server once. The numbers are a made-up test batch.
const tile = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.getByRole("term").filter({ hasText: label }) });

// Ages 1 to 10 (placed 10 days ago): deaths and feed per day.
const DEAD = [5, 4, 3, 3, 2, 2, 2, 1, 1, 1]; // 24
const FEED_KG = [12, 15, 18, 21, 24, 27, 30, 33, 36, 39]; // 255

test("checkpoint E: 10 days entered offline give the hand-computed KPIs and sync once", async ({ page, context }) => {
  test.setTimeout(180_000);
  const e164 = await ownerWithFarm(page, "Élevage des Dix Jours");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(10)); // 1 000 chicks, no day-old weight

  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  for (const [i, dead] of DEAD.entries()) {
    await page.getByLabel("Jour", { exact: true }).fill(farmDaysAgo(9 - i));
    await page.getByLabel("Morts", { exact: true }).fill(String(dead));
    await page.getByLabel("Aliment consommé (kg)", { exact: true }).fill(String(FEED_KG[i]));
    await page.getByRole("button", { name: "Enregistrer la journée" }).click();
    await expect(tile(page, "Mortalité")).toContainText(`${(DEAD.slice(0, i + 1).reduce((a, b) => a + b, 0) / 10).toFixed(1).replace(".", ",")} %`);
  }
  await page.getByLabel("Poids des oiseaux (kg), séparés par des espaces").fill("0,280 0,300 0,290");
  await page.getByRole("button", { name: "Enregistrer la pesée" }).click();

  // By hand: 24 dead of 1 000 → 2,4 %; 976 on hand; 255 kg / 976 = 261,3 g → 0,261 kg.
  // Day 10, 290 g. FCR 255 / (976 × 0,290 = 283,04) = 0,9009 → 0,90.
  // EPEF 97,6 × 0,290 / (10 × 0,9009) × 100 = 314,2 → 314. Gain 290 g / 10 days (no day-old weight) = 29,0 g.
  const check = async () => {
    await expect(tile(page, "Mortalité")).toContainText("2,4 %");
    await expect(tile(page, "Aliment par oiseau")).toContainText("0,261 kg");
    await expect(tile(page, "Poids moyen (jour 10)")).toContainText("0,29 kg");
    await expect(tile(page, "IC")).toContainText("0,90");
    await expect(tile(page, "EPEF")).toContainText("314");
    await expect(tile(page, "GMQ")).toContainText("29,0 g/jour");
  };
  await check();
  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await check();

  await context.unroute("**");
  await context.setOffline(false);
  const server = () =>
    query<{ days: number; dead: number; grams: number; weighings: number }>(
      `SELECT count(*)::int AS days, sum(dead)::int AS dead, sum("feedGrams")::int AS grams,
              (SELECT count(*)::int FROM "Weighing" w WHERE w."batchId" = $1) AS weighings
       FROM "DailyEntry" e JOIN "Membership" m ON m."organizationId" = e."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $2 AND e."batchId" = $1`,
      [ids.batch, e164],
    );
  await expect.poll(server, { timeout: 60_000 }).toEqual([{ days: 10, dead: 24, grams: 255_000, weighings: 1 }]);
});
