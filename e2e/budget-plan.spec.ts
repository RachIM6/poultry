import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T35 acceptance: the break-even and the planned margin recompute when the feed price and the sale price change.
test("a budget copied from a closed batch recomputes its break-even and margin as the prices change", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage du Budget");
  await scopeRemembered(page);
  const id = () => crypto.randomUUID();
  const [farm, house, batch, supplier, feed, buyer] = [id(), id(), id(), id(), id(), id()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "Ferme", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: house, farmId: farm, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: feed, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: id(), movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-09-01", quantity: 4_000_000, unitPriceCentimes: "460", paidCentimes: "0", dueOn: null } },
    { type: "flock.placeBatch", payload: { id: batch, houseId: house, strainId: "ross-308", placedOn: "2026-09-01", chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "550", dayOldWeightGrams: null } },
    { type: "flock.recordDay", payload: { batchId: batch, day: "2026-09-02", changes: { dead: 0, culled: 0, feed: { stockItemId: feed, grams: 3_000_000 } } } },
    { type: "sales.createBuyer", payload: { id: buyer, name: "Hamid", phone: null, type: "trader" } },
    { type: "sales.recordSale", payload: { id: id(), batchId: batch, buyerId: buyer, day: "2026-10-15", birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1400", paymentMethod: "cash", paidCentimes: "2800000", instrument: null } },
  ]);

  await expect.poll(async () => (await page.request.get("/fr/budget")).status()).toBe(200);
  await page.goto("/fr/budget");
  const figures = page.getByRole("definition");
  // 1 000 × 5,50 + 3 000 kg × 4,60 = 19 300,00 for 2 000 kg: break-even 9,65; at 14,00 DH/kg, margin 8 700,00
  await expect(page.getByLabel("Prix de l’aliment (DH/kg)")).toHaveValue("4,60");
  await expect(figures.nth(1)).toHaveText(/^9,65\sDH \/ kg$/);
  await expect(figures.nth(3)).toHaveText(/^8.700,00\sDH$/);
  // SPEC-finance §9 "Budget cash need": the copied batch's timing; every cost is paid before its one sale, on day 44
  await expect(page.getByRole("table", { name: "Besoin de trésorerie par semaine" }).getByRole("row")).toHaveCount(8); // the header and 7 weeks
  await expect(page.locator("p", { hasText: "Besoin de trésorerie maximal" })).toContainText(/semaine 7.*19.300,00\sDH/);

  await page.getByLabel("Prix de l’aliment (DH/kg)").fill("5,00"); // +1 200,00 of feed
  await expect(figures.nth(1)).toHaveText(/^10,25\sDH \/ kg$/);
  await expect(figures.nth(3)).toHaveText(/^7.500,00\sDH$/);
  await page.getByLabel("Prix de vente (DH/kg)").fill("12,00"); // the margin moves, not the break-even
  await expect(figures.nth(1)).toHaveText(/^10,25\sDH \/ kg$/);
  await expect(figures.nth(3)).toHaveText(/^3.500,00\sDH$/);

  await page.getByLabel("Nom du budget").fill("Bande de janvier");
  await page.getByRole("button", { name: "Enregistrer le budget" }).click();
  await expect(page.getByRole("list", { name: "Budgets enregistrés" }).getByRole("listitem")).toHaveText([/^Bande de janvier · seuil 10,25\sDH \/ kg, marge 3.500,00\sDH$/]);
});
