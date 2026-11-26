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
    { type: "inventory.recordPurchase", payload: { id: id(), movementId: uuidv7(), supplierId: supplier, stockItemId: feed, day: "2026-09-01", quantity: 4_000_000, unitPriceCentimes: "460", paidCentimes: "0", dueOn: "2026-10-01" } }, // 30 days' credit
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
  // SPEC-finance §9 "Budget cash need": the copied batch's timing, and the farm's own supplier delays. Its chicks go out
  // on day 0 (the placement isn't paid off: no delay known); its feed, eaten on day 1, bought with 30 days' credit, is
  // paid on day 31, in week 5. Nothing more until its one sale on day 44: the need peaks in week 5.
  const peak = page.locator("p", { hasText: "Besoin de trésorerie maximal" }).first();
  const weeks = page.getByRole("table", { name: "Besoin de trésorerie par semaine" }).getByRole("row");
  const feedDelay = page.getByLabel("Délai de paiement fournisseur de l’aliment (jours)");
  await expect(page.getByLabel("Délai de paiement fournisseur des poussins (jours)")).toHaveValue("0");
  await expect(feedDelay).toHaveValue("30");
  await expect(weeks).toHaveCount(8); // the header and 7 weeks
  await expect(peak).toContainText(/semaine 5 · 19\s300,00\sDH/);
  // The owner's own term: feed paid 50 days late, on day 51, after the sale. Only the chicks are needed before it.
  await feedDelay.fill("50");
  await expect(peak).toContainText(/semaine 1 · 5\s500,00\sDH/);
  await expect(weeks).toHaveCount(9); // the weeks run on to the payment, week 8
  await feedDelay.fill("5 0");
  await expect(feedDelay).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Indiquez chaque délai en jours entiers")).toBeVisible();
  await feedDelay.fill(""); // empty: the farm's own, 30 days
  await expect(peak).toContainText(/semaine 5 · 19\s300,00\sDH/);
  // the weeks' table scrolls on a phone, never the page (a wider page shifts every tap below it)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByLabel("Prix de l’aliment (DH/kg)").fill("5,00"); // +1 200,00 of feed
  await expect(figures.nth(1)).toHaveText(/^10,25\sDH \/ kg$/);
  await expect(figures.nth(3)).toHaveText(/^7.500,00\sDH$/);
  await page.getByLabel("Prix de vente (DH/kg)").fill("12,00"); // the margin moves, not the break-even
  await expect(figures.nth(1)).toHaveText(/^10,25\sDH \/ kg$/);
  await expect(figures.nth(3)).toHaveText(/^3.500,00\sDH$/);

  // WCAG 3.3.1, 4.1.3: a field that doesn't read is named once the user leaves it, not on each keystroke.
  const feedPrice = page.getByLabel("Prix de l’aliment (DH/kg)");
  const check = page.getByRole("alert").filter({ hasText: "Vérifiez :" });
  await feedPrice.fill("5,0x");
  await expect(check).toHaveCount(0);
  await feedPrice.blur();
  await expect(check).toHaveText("Vérifiez : Prix de l’aliment (DH/kg).");
  await expect(feedPrice).toHaveAttribute("aria-invalid", "true");
  await feedPrice.fill("5,00");
  await feedPrice.blur();
  await expect(check).toHaveCount(0);
  await expect(figures.nth(3)).toHaveText(/^3.500,00\sDH$/);

  await page.getByLabel("Nom du budget").fill("Bande de janvier");
  await page.getByRole("button", { name: "Enregistrer le budget" }).click();
  // tasks/plan-ui-cleanup.md §4: a row per saved budget, its weekly cash folded in the row under it
  const saved = page.getByRole("table", { name: "Budgets enregistrés" }).locator(":scope > tbody");
  await expect(saved.filter({ hasText: "Bande de janvier" }).getByRole("row").first()).toHaveText(/^Bande de janvier\s*10,25\sDH \/ kg\s*3.500,00\sDH$/);
  // §9 "Budget cash need": a saved budget's weeks, collapsed until asked for, from its base batch's timing
  const janvier = page.getByRole("table", { name: "Besoin de trésorerie par semaine · Bande de janvier" });
  await expect(janvier).toBeHidden();
  await saved.getByText("Besoin de trésorerie par semaine").click();
  await expect(janvier.getByRole("row")).toHaveCount(8);

  // Without a base batch: the sale day typed, saved, and the plain rule (feed daily, the rest on placement day), the
  // feed paid 30 days later (days 30 to 71)
  await page.getByLabel("Copié de la bande").selectOption({ label: "Partir de zéro" });
  await page.getByLabel("Jour de la vente (jours après la mise en place)").fill("41");
  await page.getByLabel("Nom du budget").fill("Sans base");
  await page.getByRole("button", { name: "Enregistrer le budget" }).click();
  const plain = saved.filter({ hasText: "Sans base" });
  await plain.getByText("Besoin de trésorerie par semaine").click();
  await expect(page.getByRole("table", { name: "Besoin de trésorerie par semaine · Sans base" }).getByRole("row")).toHaveCount(12); // the header and 11 weeks
  // 5 500,00 of chicks + 12 of the 42 days' feed (15 000,00 × 12 ÷ 42 = 4 285,71) before the sale on day 41, in week 6
  await expect(plain.locator("p", { hasText: "Besoin de trésorerie maximal" })).toContainText(/semaine 6 · 9\s785,71\sDH/);
});
