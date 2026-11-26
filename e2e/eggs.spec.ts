import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { controlled, farmDaysAgo, outboxEmpty, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T59 acceptance (SPEC-m3 E1): collections recorded offline on a layer batch, one corrected, kept across a reload,
// synced; the Arabic screen shows them too.
test("egg collections offline: two a day, one corrected, synced", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Pondeuses");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(0), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 273 },
    },
  ]);
  await page.goto("/fr/batches");
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  // P-EggCollect's collection: 1 642 normal, 18 cracked, 31 dirty, 6 double-yolk, 12 floor, 4 broken = 1 713.
  await page.getByLabel("Normaux", { exact: true }).fill("1642");
  await page.getByLabel("Fêlés", { exact: true }).fill("17");
  await page.getByRole("button", { name: "Ajouter 1 · Fêlés" }).click();
  for (const [label, n] of [["Sales", "31"], ["Double jaune", "6"], ["Œufs de sol", "12"], ["Cassés", "4"]]) await page.getByLabel(label, { exact: true }).fill(n);
  await expect(page.getByText(/Ce ramassage : 1.713 œufs · déclassés 3,8 %/)).toBeVisible(); // 65 / 1 713
  await page.getByRole("button", { name: "Enregistrer le ramassage" }).click();
  await expect(page.getByText(/Ramassage 1 · 1.713 œufs · 65 déclassés/)).toBeVisible();

  await page.getByLabel("Normaux", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Enregistrer le ramassage" }).click();
  await page.getByRole("button", { name: "Corriger", exact: true }).nth(1).click();
  await page.getByLabel("Normaux", { exact: true }).fill("1100");
  await page.getByRole("button", { name: "Enregistrer la correction" }).click();
  await expect(page.getByText(/Ramassage 2 · 1.100 œufs · 0 déclassés/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Ramassage 2 · 1.100 œufs/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const eggs = async () =>
    await query<{ normal: number; n: number }>(
      `SELECT sum(c.normal)::int AS normal, count(*)::int AS n FROM "EggCollection" c JOIN "Membership" m ON m."organizationId" = c."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(eggs).toEqual([{ normal: 2742, n: 2 }]);

  await page.goto(`/ar/batches#${ids.batch}`);
  await expect(page.getByRole("heading", { name: "جمع البيض" })).toBeVisible();
  await expect(page.getByText(/الجمعة 2 · 1.100 بيضة/)).toBeVisible();
});

// T60 acceptance (SPEC-m3 E2–E4): the farm's egg stock by grade and age, grading and a discard, offline then synced.
test("egg stock: grade a day's eggs, discard some, offline", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Stock d’Œufs");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID() };
  const counts = { normal: 2700, cracked: 30, dirty: 20, doubleYolk: 0, floor: 10, broken: 5 };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(3), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 273 },
    },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(3), counts, sample: null } },
  ]);
  await page.goto("/fr/eggs");
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByText(/2.760 œufs en stock · 92 plateaux/)).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const lot = (item: string) => page.getByRole("table", { name: "Ramassages" }).getByRole("row").filter({ hasText: item });
  const sheet = page.getByRole("dialog"); // grading and discarding open in a sheet
  await expect(lot("Non calibrés")).toContainText(/Non calibrés\s*2.700/);
  await lot("Non calibrés").getByRole("button", { name: "Calibrer" }).click();
  await sheet.getByLabel("Calibre M").fill("2701");
  await sheet.getByRole("button", { name: "Enregistrer le calibrage" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Pas assez d’œufs dans ce ramassage.");
  await sheet.getByLabel("Calibre M").fill("2000");
  await sheet.getByLabel("Calibre L").fill("650");
  await sheet.getByRole("button", { name: "Enregistrer le calibrage" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(lot("Non calibrés")).toContainText(/Non calibrés\s*50(?!\d)/);

  await expect(lot("Déclassés")).toContainText(/Déclassés\s*60(?!\d)/);
  await lot("Déclassés").getByRole("button", { name: "Écarter" }).click();
  await sheet.getByLabel("Œufs écartés").fill("10");
  await sheet.getByLabel("Raison").fill("Cassés au transport");
  await sheet.getByRole("button", { name: "Écarter ces œufs" }).click();
  await expect(lot("Déclassés")).toContainText(/Déclassés\s*50(?!\d)/);
  await expect(page.getByText(/2.750 œufs en stock/)).toBeVisible();
  await expect(page.getByText("Pondus il y a 3 à 5 jours")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const written = async () =>
    await query<{ graded: number; discarded: number }>(
      `SELECT (SELECT count(*)::int FROM "EggGrading" g WHERE g."organizationId" = m."organizationId") AS graded,
              (SELECT sum(eggs)::int FROM "EggDiscard" d WHERE d."organizationId" = m."organizationId") AS discarded
       FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(written).toEqual([{ graded: 1, discarded: 10 }]);
});

// T61 acceptance (SPEC-m3 E5, B14): a layer batch's KPIs from its records, offline, in French and Arabic.
test("layer KPIs: hens, laying rate, eggs per hen housed, downgraded, weekly table", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Indicateurs Ponte");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID() };
  const counts = { normal: 90, cracked: 2, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(1), chicksPlaced: 100, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 140 },
    },
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(1), changes: { dead: 1, waterMl: 20_000 } } },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(0), counts, sample: { count: 10, grams: 618 } } },
  ]);
  await page.goto(`/fr/batches`);
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  const tile = (label: string) => page.locator("dl > div").filter({ hasText: label });
  await expect(tile("Poules présentes")).toContainText("99");
  await expect(tile("Taux de ponte")).toContainText("92,9 %"); // 92 eggs ÷ 99 hens this morning
  await expect(tile("Taux de ponte")).toContainText("pas de standard chargé"); // MQ1
  await expect(tile("Œufs par poule logée")).toContainText("0,9");
  await expect(tile("Poids moyen de l’œuf")).toContainText("61,8 g");
  await expect(tile("Œufs déclassés")).toContainText("2,2 %");
  await expect(page.getByRole("table", { name: "Dernières semaines" })).toContainText("20");

  await page.goto(`/ar/batches#${ids.batch}`);
  await expect(page.locator("dl > div").filter({ hasText: "نسبة الوضع" })).toContainText("92,9 %");
});

// T62 acceptance (SPEC-m3 H7): a layer batch's treatment asks for the egg withdrawal and shows the banner, offline.
test("a layer batch's treatment withholds its eggs until the egg withdrawal ends", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Retrait Œufs");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID(), supplier: crypto.randomUUID(), medicine: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Véto", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.medicine, farmId: ids.farm, productId: null, kind: "medicine", name: "Amoxicilline", unit: "ml", lot: "AMX-1", expiresOn: farmDaysAgo(-365) } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.medicine, day: farmDaysAgo(5), quantity: 1000, unitPriceCentimes: "50", paidCentimes: "0", dueOn: null } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(5), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 200 },
    },
  ]);
  await page.goto(`/fr/batches`);
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  await page.getByRole("button", { name: "Ajouter un traitement" }).click();
  await page.getByLabel("Quantité utilisée (ml)").fill("250");
  await page.getByLabel("Dose prescrite").fill("1 ml par litre d’eau");
  await page.getByLabel("Motif").fill("Colibacillose");
  await page.getByLabel("Prescrit par").fill("Dr Alaoui");
  await page.getByLabel("Délai d’attente viande (jours)").fill("3");
  await page.getByLabel("Délai d’attente œufs (jours)").fill("7"); // made up for the test (MQ4)
  await page.getByRole("button", { name: "Enregistrer le traitement" }).click();
  await expect(page.getByText(/Œufs à retirer de la vente jusqu’au/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const stored = async () =>
    await query<{ days: number }>(
      `SELECT t."eggWithdrawalDays" AS days FROM "Treatment" t JOIN "Membership" m ON m."organizationId" = t."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(stored).toEqual([{ days: 7 }]);
});

// T63 acceptance (SPEC-m3 V6): eggs sold by the tray offline, oldest first; stock and receivables follow once synced.
test("egg sale by the tray, offline: stock drops, the buyer owes the amount", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Vente d’Œufs");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID(), buyer: crypto.randomUUID() };
  const counts = (normal: number) => ({ normal, cracked: 0, dirty: 0, doubleYolk: 0, floor: 0, broken: 0 });
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "layer", strainId: "lohmann-brown", placedOn: farmDaysAgo(5), chicksPlaced: 6000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 273 },
    },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(3), counts: counts(300), sample: null } },
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(1), counts: counts(600), sample: null } },
    { type: "eggs.gradeEggs", payload: { id: uuidv7(), batchId: ids.batch, laidOn: farmDaysAgo(3), grades: { m: 300 } } },
    { type: "eggs.gradeEggs", payload: { id: uuidv7(), batchId: ids.batch, laidOn: farmDaysAgo(1), grades: { m: 600 } } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Grossiste Al Wafa", phone: null, type: "trader" } },
  ]);
  await page.goto("/fr/eggs");
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByText(/900 œufs en stock · 30 plateaux/)).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Vendre des œufs" }).click();
  await page.getByLabel("Plateaux").fill("15");
  await page.getByLabel("Prix d’un plateau (DH)").fill("33,00");
  await page.getByLabel("Mode de paiement").selectOption({ label: "Crédit" });
  await expect(page.getByText(/Montant : 495,00.DH/)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();
  await expect(page.getByText(/450 œufs en stock · 15 plateaux/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const sold = async () =>
    await query<{ amount: string; drawn: number }>(
      `SELECT s."amountCentimes"::text AS amount, (SELECT sum(eggs)::int FROM "EggDraw" d WHERE d."saleId" = s.id) AS drawn
       FROM "Sale" s JOIN "Membership" m ON m."organizationId" = s."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(sold).toEqual([{ amount: "49500", drawn: 450 }]);
});
