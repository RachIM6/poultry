import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T48 acceptance (browser part): a closed batch's report shows its figures and the same margin as /results, which
// both read from finance's batch result (SPEC-m2-compliance RP3, D7). The builder: reporting/domain/report.test.ts.
test("a closed batch's report shows its figures and the margin of /results", async ({ page }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage du Rapport");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(40));
  const buyer = crypto.randomUUID();
  await pushAs(page, [
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(10), changes: { dead: 20, deathCause: "unknown", culled: 0, feed: { stockItemId: ids.feed, grams: 900_000 } } } },
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Doukkala", phone: null, type: "abattoir" } },
    {
      type: "sales.recordSale",
      payload: { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(0), birds: 980, farmWeightGrams: 2_400_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3600000", instrument: null },
    },
  ]);

  await page.goto("/fr/results");
  const resultRow = page.getByRole("row").nth(1);
  await expect(resultRow).toBeVisible();
  const margin = (await resultRow.getByRole("cell").nth(3).innerText()).trim();

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.getByRole("link", { name: "Rapport de bande" }).click();
  const doc = page.getByRole("article");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("Rapport de bande");
  await expect(doc).toContainText(/Clôturée le/);
  await expect(doc).toContainText("1 000"); // chicks placed
  await expect(doc).toContainText(/20 · 2,0\s%/); // dead and mortality
  await expect(doc).toContainText(/980\s+·\s+2\s*400\s+kg/);
  await expect(doc).toContainText("Vaccins faits : 0 sur 0");
  await expect(doc.getByText("Marge", { exact: true }).locator("..")).toContainText(margin);
  await expect(doc.getByRole("table", { name: "Comparaison avec les bandes précédentes de la ferme" }).getByRole("row")).toHaveCount(2);
});

// SPEC-finance §9 "Laying hens in the batch result", "Typing the schedule" (§7.1 I.6): a cash-book farm types its layer
// batch's laying period and cull value on /results, and the hens line moves from the birds gone to the depreciation.
test("a laying flock's schedule typed on /results depreciates its hens", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage des Pondeuses");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), hens: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Ponte", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 12000, type: "closed" } },
    // 1 000 point-of-lay hens at 55,00 today, 10 dead: 550,00 of their 55 000,00 used up, until a schedule is typed
    {
      type: "flock.placeBatch",
      payload: { id: ids.hens, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(0), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "5500", dayOldWeightGrams: null, ageAtPlacementDays: 126 },
    },
    { type: "flock.recordDay", payload: { batchId: ids.hens, day: farmDaysAgo(0), changes: { dead: 10, deathCause: "unknown", culled: 0 } } },
  ]);

  await page.goto("/fr/results");
  const hens = page.getByText(/^Poules : prix d’entrée/);
  await expect(hens).toContainText(/Compté ici .*550,00/);
  await page.getByText("Détail", { exact: true }).click(); // the batch's detail and its schedule form fold under its row
  await page.getByLabel(/^Durée de ponte \(mois\) :/).fill("10");
  await page.getByLabel(/^Valeur de réforme :/).fill("5000");
  await page.getByRole("button", { name: "Enregistrer la durée et la réforme" }).click();
  await expect(page.getByText("Durée de ponte et valeur de réforme enregistrées.")).toBeVisible();
  // this month, whole (FC1): (55 000,00 − 5 000,00) × 1 ÷ 10
  await expect(hens).toContainText(/Amortissement à ce jour 5\s000,00/);
  await expect(page.getByLabel(/^Durée de ponte \(mois\) :/)).toHaveValue("10");
});
