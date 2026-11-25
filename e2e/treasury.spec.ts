import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// SPEC-finance §9 "Default cash box and bank account" (browser part): a sale paid in cash and a purchase paid by
// transfer name no account; they land on the farm's cash box and bank account, so /treasury shows a balance per account
// and no "non affecté" line. With a second bank account the owner picks the default. Rules: treasury-defaults.int.test.ts.
test("cash and bank paid with no account named go on the default cash box and bank account", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de la Trésorerie");
  await scopeRemembered(page);
  const id = () => crypto.randomUUID();
  const ids = { farm: id(), house: id(), supplier: id(), feed: id(), batch: id(), buyer: id(), box: id(), bankA: id(), bankB: id() };
  const bankPurchase = (paid: string) => ({
    type: "inventory.recordPurchase",
    payload: { id: id(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: farmDaysAgo(1), quantity: Number(paid) * 1000 / 450, unitPriceCentimes: "450", paidCentimes: paid, paidMethod: "transfer", dueOn: null },
  });
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "finance.createTreasuryAccount", payload: { id: ids.box, kind: "cash", name: "Caisse ferme" } },
    { type: "finance.createTreasuryAccount", payload: { id: ids.bankA, kind: "bank", name: "Banque A" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    bankPurchase("450000"), // 1 000 kg at 4,50, paid by transfer
    { type: "flock.placeBatch", payload: { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: farmDaysAgo(40), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Hamid", phone: null, type: "trader" } },
    { type: "sales.recordSale", payload: { id: id(), batchId: ids.batch, buyerId: ids.buyer, day: farmDaysAgo(0), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "300000", instrument: null } },
  ]);

  await page.goto("/fr/treasury");
  const balances = page.getByRole("list", { name: "Soldes" }).getByRole("listitem");
  await expect(balances).toHaveText([/^Banque · Banque A\s*-4.500,00\sDH$/, /^Caisse · Caisse ferme\s*3.000,00\sDH$/, /^Total disponible\s*-1.500,00\sDH$/]);
  await expect(page.getByText("Non affecté à un compte")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Mettre par défaut/ })).toHaveCount(0); // one of each: nothing to pick

  // A second bank account: the first stays the default until the owner picks the other.
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: ids.bankB, kind: "bank", name: "Banque B" } }]);
  await page.reload();
  await expect(balances.filter({ hasText: "Banque A" })).toContainText("(Par défaut)");
  await balances.filter({ hasText: "Banque B" }).getByRole("button", { name: "Mettre par défaut : Banque B" }).click();
  await expect(balances.filter({ hasText: "Banque B" })).toContainText("(Par défaut)");
  await expect(balances.filter({ hasText: "Banque A" }).getByRole("button", { name: "Mettre par défaut : Banque A" })).toBeVisible();

  await pushAs(page, [bankPurchase("90000")]); // 200 kg at 4,50
  await page.reload();
  await expect(balances.filter({ hasText: "Banque B" })).toContainText(/-900,00\sDH/);
  await expect(balances.filter({ hasText: "Banque A" })).toContainText(/-4.500,00\sDH/);
  await expect(page.getByText("Non affecté à un compte")).toHaveCount(0);
});
