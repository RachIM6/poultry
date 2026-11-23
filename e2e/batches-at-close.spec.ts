import { expect, test } from "@playwright/test";
import { ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T109 (SPEC-finance FC4, FQ19, FQ20): a broiler batch still open on 31 December 2025 (flock refuses days not yet
// come): 10 000 chicks at 6,00, 2 000 sold, 400 dead, 7 600 on hand. At cost by head: 60 000,00 × 7 600 ÷ 9 600 =
// 47 500,00 on 31322. Never weighed, so no current value is suggested: the run refuses until the owner types one,
// 45 000,00, for a provision of 2 500,00 (D 61961 / C 3913). §7.1 C, the as-of day, the PCA off and the reversals in
// detail: src/modules/finance/batches-at-close.int.test.ts.
test("the owner reads an open batch at cost in the close preview, types its current value, and posts it with its provision", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Bandes en cours");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), buyer: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "B1", areaM2: 1000, capacity: 12000, type: "closed" } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Hamid", phone: null, type: "trader" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: "2025-11-01", chicksPlaced: 10_000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "600", dayOldWeightGrams: null },
    },
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: "2025-11-20", changes: { dead: 400, culled: 0 } } },
    {
      type: "sales.recordSale",
      payload: { id: crypto.randomUUID(), batchId: ids.batch, buyerId: ids.buyer, day: "2025-12-10", birds: 2000, farmWeightGrams: 4_000_000, buyerWeightGrams: null, pricePerKgCentimes: "850", paymentMethod: "cash", paidCentimes: "3400000", instrument: null },
    },
  ]);

  // The preview: D 31322 / C 71311 at cost, the batch with its birds on hand and no value to suggest.
  await page.goto("/fr/closing?year=2025");
  const section = page.getByRole("region", { name: "Bandes en cours (animaux)" });
  await expect(section).toContainText("À comptabiliser.");
  const entry = section.getByRole("table", { name: "Écriture · Bandes en cours (animaux)" }).getByRole("row");
  await expect(entry).toHaveCount(3);
  await expect(entry.nth(1)).toContainText(/^31322 Animaux\s*47\s500,00/);
  await expect(entry.nth(2)).toContainText(/^71311 Variation des stocks de biens produits en cours\s*47\s500,00/);
  const line = section.getByRole("table", { name: "Bandes en cours au coût engagé" }).getByRole("row").filter({ hasText: "B1" });
  await expect(line).toContainText(/B1 · Poulet de chair\s*Ferme Atlas\s*7\s600\s*47\s500,00\sDH/);
  await expect(line).toContainText("Valeur à saisir : ni pesée ni vente pour la proposer.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // fits the phone

  // The run refuses while the batch has no current value.
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Saisissez la valeur actuelle" })).toHaveText("Saisissez la valeur actuelle des bandes en cours sans pesée ou sans vente avant de comptabiliser.");

  // The owner's 45 000,00: a provision of 2 500,00, D 61961 / C 3913.
  await section.getByRole("textbox", { name: "Valeur actuelle : B1 · Poulet de chair" }).fill("45 000");
  await section.getByRole("button", { name: "Enregistrer les valeurs actuelles" }).click();
  await expect(section.getByRole("status")).toHaveText("Valeurs actuelles enregistrées.");
  await expect(line).toContainText(/2\s500,00\sDH$/);
  await expect(line).not.toContainText("Valeur à saisir");
  const provisionRows = page.getByRole("region", { name: "Provisions pour dépréciation" }).getByRole("table", { name: "Écriture · Provisions pour dépréciation" }).getByRole("row");
  await expect(provisionRows.nth(1)).toContainText(/^61961 D\.E\.P\. pour dépréciation des stocks\s*2\s500,00/);
  await expect(provisionRows.nth(2)).toContainText(/^3913 Provisions pour dépréciation des produits en cours\s*2\s500,00/);

  // Posted, then frozen.
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 2.")).toBeVisible();
  await expect(section).toContainText("Comptabilisée, sans changement.");
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await expect(line).toContainText(/45\s000,00\sDH/);

  await page.goto("/fr/books?view=journals&month=2025-12");
  const posted = page.getByRole("table").filter({ hasText: "31 décembre 2025 · Encours de production : animaux" });
  await expect(posted.getByRole("row").filter({ hasText: /^31322 / })).toContainText(/47\s500,00/);
  await expect(posted.getByRole("row").filter({ hasText: /^71311 / })).toContainText(/47\s500,00/);

  // Arabic, right to left: the tables scroll, not the page.
  await page.goto("/ar/closing?year=2025");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("region", { name: "الأفواج قيد الإنتاج (حيوانات)" })).toContainText("31322");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
