import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { closeRun, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T113 (SPEC-finance FC5, FQ18): 1 200 eggs laid on 30 December 2025 (eggs refuse days not yet come), 1 180 counted.
// The run refuses until the owner types a value per egg, 0,95 DH; then it posts D 3152 / C 71321 1 121,00 in the stock
// entry, found in the journal on 31 December. The day rule, the PCA off, the reruns and the reversal in detail:
// src/modules/finance/eggs-at-close.int.test.ts.
test("the owner counts the eggs, types a value per egg, and posts them in the stock entry", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Œufs de clôture");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: "2025-11-01", chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 273 },
    },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.batch, day: "2025-12-30", counts: { normal: 1200, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 }, sample: null } },
  ]);

  // The count sheet (FC3): the farm's eggs with their book quantity, no amount; then the count.
  await page.goto("/fr/closing/count?year=2025");
  const eggs = page.getByRole("table", { name: "Œufs" }).getByRole("row");
  await expect(eggs).toHaveCount(2);
  await expect(eggs.nth(1)).toContainText(/Stock d’œufs\s*1\s200 œufs/);
  await page.getByRole("textbox", { name: "Compté : Stock d’œufs" }).fill("1 180");
  await page.getByRole("button", { name: "Enregistrer le comptage" }).click();
  await expect(page.getByRole("status")).toHaveText("Comptage enregistré.");
  await expect(eggs.nth(1)).toContainText(/−20 œufs/);

  // The preview: the eggs counted, a value per egg required, so the run refuses.
  await page.goto("/fr/closing?year=2025");
  const stock = page.getByRole("region", { name: "Stocks", exact: true });
  const line = stock.getByRole("table", { name: "Œufs en stock" }).getByRole("row").filter({ hasText: "Ferme Atlas" });
  await expect(line).toContainText(/Ferme Atlas\s*1\s180\s*Valeur par œuf à saisir\./);
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Saisissez la valeur par œuf" })).toHaveText("Saisissez la valeur par œuf des œufs en stock avant de comptabiliser.", closeRun);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // fits the phone

  // FQ18: the owner's value per egg; the stock entry, D 3152 / C 71321 at 1 180 × 0,95.
  await stock.getByRole("textbox", { name: "Valeur par œuf : Ferme Atlas" }).fill("0,95");
  await stock.getByRole("button", { name: "Enregistrer les valeurs actuelles" }).click();
  await expect(stock.getByRole("status")).toHaveText("Valeurs actuelles enregistrées.");
  await expect(line).toContainText(/1\s121,00\sDH$/);
  const entry = stock.getByRole("table", { name: "Écriture · Stocks" }).getByRole("row");
  await expect(entry).toHaveCount(3);
  await expect(entry.nth(1)).toContainText(/^3152 Produits finis \(d’animaux\)\s*1\s121,00/);
  await expect(entry.nth(2)).toContainText(/^71321 Variation des stocks de produits finis\s*1\s121,00/);

  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 1.")).toBeVisible(closeRun);
  await expect(stock).toContainText("Comptabilisée, sans changement.");
  await expect(stock.getByRole("textbox")).toHaveCount(0);

  await page.goto("/fr/books?view=journals&month=2025-12");
  const posted = page.getByRole("table").filter({ hasText: "31 décembre 2025 · Stocks de fin d’exercice" });
  await expect(posted.getByRole("row").filter({ hasText: /^3152 / })).toContainText(/1\s121,00/);
  await expect(posted.getByRole("row").filter({ hasText: /^71321 / })).toContainText(/1\s121,00/);

  // Arabic, right to left: the eggs line, and the page doesn't scroll sideways.
  await page.goto("/ar/closing?year=2025");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("region", { name: "المخزونات", exact: true }).getByRole("table", { name: "البيض المخزون" })).toContainText("Ferme Atlas");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
