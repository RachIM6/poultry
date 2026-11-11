import { expect, test, type Page } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, query, referenceCached, scopeRemembered, syntheticStrain } from "./auth";

// T18 acceptance (browser part): the batch dashboard offline, after 3 daily entries and a weighing, updated as soon as
// each is saved. The formulas themselves are checked on a hand-computed batch in src/modules/flock/domain/kpi.test.ts.
const tile = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.getByRole("term").filter({ hasText: label }) });

test("the batch dashboard works offline and follows each entry", async ({ page, context }) => {
  test.setTimeout(120_000);
  const strain = await syntheticStrain();
  try {
    await ownerWithFarm(page, "Élevage des Indicateurs");
    await scopeRemembered(page);
    await farmWithBatch(page, strain, farmDaysAgo(2)); // 1 000 chicks, no day-old weight

    await page.goto("/fr/batches");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await referenceCached(page);
    await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));
    await page.getByRole("link", { name: "Saisir le jour" }).click();
    await expect(tile(page, "Mortalité")).toContainText("0,0 %");
    await expect(page.getByText("Pesez un échantillon pour voir le poids, l’IC, l’EPEF et le GMQ.")).toBeVisible();

    const enter = async (daysAgo: number, dead: string, feedKg: string) => {
      await page.getByLabel("Jour", { exact: true }).fill(farmDaysAgo(daysAgo));
      await page.getByLabel("Morts").fill(dead);
      await page.getByLabel("Aliment consommé (kg)").fill(feedKg);
      await page.getByRole("button", { name: "Enregistrer la journée" }).click();
    };
    await enter(2, "10", "20");
    await expect(tile(page, "Mortalité")).toContainText("1,0 %"); // right after the entry
    await enter(1, "5", "25");
    await enter(0, "5", "30");
    // 20 dead of 1 000 → 2,0 %; 75 kg / 980 birds = 76,5 g → 0,077 kg.
    await expect(tile(page, "Mortalité")).toContainText("2,0 %");
    await expect(tile(page, "Aliment par oiseau")).toContainText("0,077 kg");
    await expect(tile(page, "IC")).toContainText("—");

    await page.getByLabel("Poids des oiseaux (kg), séparés par des espaces").fill("0,080 0,090 0,085");
    await page.getByRole("button", { name: "Enregistrer la pesée" }).click();
    // Day 2, 85 g. Standard 40 + 160 × 2/7 = 86 g → −1,2 %. FCR 75 / (980 × 0,085) = 0,90.
    // EPEF 98 × 0,085 / (2 × 0,9004) × 100 = 463. Gain 85 g / 2 days (no day-old weight) = 42,5 g.
    await expect(tile(page, "Poids moyen (jour 2)")).toContainText("0,085 kg");
    await expect(tile(page, "Poids moyen (jour 2)")).toContainText("-1,2 % par rapport au standard (0,086 kg)");
    await expect(tile(page, "IC")).toContainText("0,90");
    await expect(tile(page, "EPEF")).toContainText("463");
    await expect(tile(page, "GMQ")).toContainText("42,5 g/jour");
    await expect(page.getByRole("img", { name: /Poids moyen par âge : J2 0,085 kg/ })).toBeVisible();

    const reload = await page.reload(); // still offline: the shell and the data come from the phone
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(tile(page, "EPEF")).toContainText("463");
    await context.unroute("**");
    await context.setOffline(false);
  } finally {
    await query(`DELETE FROM "Strain" WHERE id = $1`, [strain]);
  }
});
