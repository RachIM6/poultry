import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

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
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
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
  await page.getByRole("button", { name: "Corriger" }).nth(1).click();
  await page.getByLabel("Normaux", { exact: true }).fill("1100");
  await page.getByRole("button", { name: "Enregistrer la correction" }).click();
  await expect(page.getByText(/Ramassage 2 · 1.100 œufs · 0 déclassés/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Ramassage 2 · 1.100 œufs/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
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
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByText(/2.760 œufs en stock · 92 plateaux/)).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const ungraded = page.getByRole("listitem").filter({ hasText: "Non calibrés : 2" });
  await ungraded.getByRole("button", { name: "Calibrer" }).click();
  await ungraded.getByLabel("Calibre M").fill("2701");
  await ungraded.getByRole("button", { name: "Enregistrer le calibrage" }).click();
  await expect(ungraded.getByRole("alert")).toHaveText("Pas assez d’œufs dans ce lot.");
  await ungraded.getByLabel("Calibre M").fill("2000");
  await ungraded.getByLabel("Calibre L").fill("650");
  await ungraded.getByRole("button", { name: "Enregistrer le calibrage" }).click();
  await expect(page.getByText(/Non calibrés : 50 œufs/)).toBeVisible();

  const downgraded = page.getByRole("listitem").filter({ hasText: "Déclassés : 60" });
  await downgraded.getByRole("button", { name: "Écarter" }).click();
  await downgraded.getByLabel("Œufs écartés").fill("10");
  await downgraded.getByLabel("Raison").fill("Cassés au transport");
  await downgraded.getByRole("button", { name: "Écarter ces œufs" }).click();
  await expect(page.getByText(/Déclassés : 50 œufs/)).toBeVisible();
  await expect(page.getByText(/2.750 œufs en stock/)).toBeVisible();
  await expect(page.getByText("Pondus il y a 3 à 5 jours")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
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
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
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
