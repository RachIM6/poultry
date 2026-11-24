import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T53 acceptance (SPEC-m3 B7, B8): a layer batch placed at 18 weeks counts its age in weeks, and two beldi bands share a
// run, offline, then synced; the Arabic screen shows the same age.
test("hens placed at 18 weeks show their age in weeks, and beldi bands share a run", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Toutes Productions");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), run: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    { type: "farm-registry.createHouse", payload: { id: ids.run, farmId: ids.farm, name: "Parcours", areaM2: 2000, capacity: 1000, type: "open" } },
  ]);

  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("button", { name: "Mettre en place une bande" })).toBeVisible(); // the houses reached the phone
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const place = async (type: string, house: string, birds: string, weeks: string) => {
    await page.getByRole("button", { name: "Mettre en place une bande" }).click();
    await page.getByLabel("Production").selectOption({ label: type });
    await page.getByLabel("Bâtiment").selectOption(house);
    await page.getByLabel("Âge à la mise en place (semaines)").fill(weeks);
    await page.getByLabel("Poussins placés").fill(birds);
    await page.getByLabel("Couvoir").fill("Élevage de poulettes Atlas");
    await page.getByLabel("N° de bon de livraison").fill("BL-77");
    await page.getByLabel("Prix d’un poussin (DH)").fill("0");
    await page.getByRole("button", { name: "Enregistrer" }).click();
  };
  await place("Pondeuse", ids.house, "6000", "18");
  await expect(page.getByText("18 sem.", { exact: true })).toBeVisible();
  await expect(page.getByText("Pondeuse · Ferme Atlas · Bâtiment P1 · Lohmann Brown")).toBeVisible();
  await place("Beldi / plein air", ids.run, "140", "22");
  await place("Beldi / plein air", ids.run, "130", "3");
  await expect(page.getByText("22 sem.", { exact: true })).toBeVisible();
  await expect(page.getByText("3 sem.", { exact: true })).toBeVisible();
  await place("Pondeuse", ids.house, "100", "18"); // still one open layer batch per house
  await expect(page.getByRole("alert").filter({ hasText: "Ce bâtiment a déjà une bande en cours" })).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();

  // T56 (SPEC-m3 B11): the run's bands together, each with its own day.
  await expect(page.getByText("Parcours · 2 bandes · 270 sujets")).toBeVisible();
  for (const age of ["22 sem.", "3 sem."]) {
    await page.getByRole("listitem").filter({ hasText: age }).getByRole("link", { name: "Saisir le jour" }).click();
    await page.getByLabel("Morts").fill("1");
    await page.getByRole("button", { name: "Enregistrer la journée" }).click();
    await page.getByRole("link", { name: "Toutes les bandes" }).click();
  }
  await expect(page.getByText("Parcours · 2 bandes · 268 sujets")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const dead = async () =>
    await query<{ dead: number }>(
      `SELECT sum(d.dead)::int AS dead FROM "DailyEntry" d JOIN "Batch" b ON b.id = d."batchId" JOIN "Membership" m ON m."organizationId" = b."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND b.species = 'beldi'`,
      [e164],
    );
  await expect.poll(dead).toEqual([{ dead: 2 }]);
  const batches = async () =>
    await query<{ species: string; age: number }>(
      `SELECT b.species, b."ageAtPlacementDays" AS age FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND b.status = 'open' ORDER BY b."ageAtPlacementDays"`,
      [e164],
    );
  await expect.poll(batches).toEqual([{ species: "beldi", age: 21 }, { species: "layer", age: 126 }, { species: "beldi", age: 154 }]);

  await page.goto("/ar/batches");
  await expect(page.getByText("18 أسبوع", { exact: true })).toBeVisible();
  await page.goto("/fr/dashboard"); // "Aujourd'hui": every type, ages in weeks (T56)
  await expect(page.getByText("22 sem.", { exact: true })).toBeVisible();
  await expect(page.getByText("Parcours · Beldi / plein air").first()).toBeVisible();
});

// T54 acceptance (SPEC-m3 B9): turkeys placed "sexes séparés" become one batch per sex in the same house, offline.
test("turkeys placed by sex become two batches side by side", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Dindes");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment D1", areaM2: 1500, capacity: 3000, type: "closed" } },
  ]);
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("button", { name: "Mettre en place une bande" })).toBeVisible(); // the house reached the phone
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await page.getByLabel("Production").selectOption({ label: "Dinde" });
  await page.getByLabel("Souche").selectOption({ label: "BUT 6" });
  await page.getByLabel("Sexes séparés").check();
  await page.getByLabel("Femelles placées").fill("1500");
  await page.getByLabel("Mâles placés").fill("1500");
  await page.getByLabel("Mâles morts à l’arrivée").fill("4");
  await page.getByLabel("Couvoir").fill("Couvoir Chaouia");
  await page.getByLabel("N° de bon de livraison").fill("BL-26-4471");
  await page.getByLabel("Prix d’un poussin (DH)").fill("12,00");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Dinde · femelles · Ferme Sidi Hajjaj · Bâtiment D1 · BUT 6")).toBeVisible();
  await expect(page.getByText("Dinde · mâles · Ferme Sidi Hajjaj · Bâtiment D1 · BUT 6")).toBeVisible();

  await page.getByRole("link", { name: "Saisir le jour" }).first().click();
  // Both sexes side by side with their birds and cumulative FCR (none before a weighing); the other sex opens its day.
  const sexes = page.getByRole("region", { name: "Même lot, par sexe" });
  await expect(sexes.getByText(/^1.500 sujets$/)).toBeVisible();
  await expect(sexes.getByText(/^1.496 sujets$/)).toBeVisible();
  await expect(sexes.getByText("IC —")).toHaveCount(2);
  const other = sexes.getByRole("link");
  const before = (await other.textContent())!;
  await other.click();
  await expect(other).not.toHaveText(before); // the link now leads back to the first sex

  await context.unroute("**");
  await context.setOffline(false);
  const batches = async () =>
    await query<{ sex: string; birds: number }>(
      `SELECT b.sex, b."chicksPlaced" - b."deadOnArrival" AS birds FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY b.sex`,
      [e164],
    );
  await expect.poll(batches).toEqual([{ sex: "female", birds: 1500 }, { sex: "male", birds: 1496 }]);
});

// T55 acceptance (SPEC-m3 B10): the free supplement counts in the birds placed, the density shows, and a dead-on-arrival
// count above the farm's own threshold shows a claim; P-ChickArrival's example, offline.
test("chick arrival: supplement, density and the hatchery claim above the farm's threshold", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Arrivée");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null, doaClaimThresholdPermille: 1 } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1000, capacity: 12000, type: "closed" } },
  ]);
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await page.getByLabel("Poussins placés").fill("10000");
  await page.getByLabel("Supplément gratuit (facultatif)").fill("200");
  await page.getByLabel("Morts à l’arrivée").fill("14");
  await page.getByLabel("Couvoir").fill("Couvoir Chaouia");
  await page.getByLabel("N° de bon de livraison").fill("BL 26-4471");
  await page.getByLabel("Prix d’un poussin (DH)").fill("5,20");
  await page.getByLabel("Lot reproducteur").fill("PS-12");
  await page.getByLabel("Poussins faibles").fill("22");
  await page.getByLabel("Température litière (°C)").fill("31");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  await expect(page.getByText(/Oiseaux présents : 10.186/).first()).toBeVisible();
  await expect(page.getByText("Densité : 10,2 sujets/m²")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "réclamation au couvoir" })).toBeVisible(); // 14 of 10 200 > 1 ‰
});

// T57 acceptance (SPEC-m3 B12): a pullet weighing shows its uniformity next to the CV, offline.
test("a pullet weighing shows the uniformity", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage des Poulettes");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment P2", areaM2: 800, capacity: 5000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, species: "pullet", strainId: "lohmann-brown", placedOn: farmDaysAgo(0), chicksPlaced: 4800, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 77 },
    },
  ]);
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByText("11 sem.", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  // Mean 1 000 g; 880 g is outside 900–1 100 g: 5 of 6 → 83,3 %.
  await page.getByLabel("Poids des oiseaux (kg), séparés par des espaces").fill("0,950 1,000 1,050 1,100 0,880 1,020");
  await expect(page.getByText(/Homogénéité 83,3 %/)).toBeVisible();
});

// T58 acceptance (SPEC-m3 B13): pullets move to the laying house offline; the layer batch keeps their age, the pullet
// batch closes and the birds left behind are culled once synced.
test("pullets move to the laying house and become a layer batch", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Passage en Ponte");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), rearing: crypto.randomUUID(), laying: crypto.randomUUID(), batch: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.rearing, farmId: ids.farm, name: "Bâtiment P2", areaM2: 800, capacity: 5000, type: "closed" } },
    { type: "farm-registry.createHouse", payload: { id: ids.laying, farmId: ids.farm, name: "Bâtiment P1", areaM2: 1000, capacity: 6000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.rearing, species: "pullet", strainId: "lohmann-brown", placedOn: farmDaysAgo(0), chicksPlaced: 4800, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "700", dayOldWeightGrams: null, ageAtPlacementDays: 119 },
    },
  ]);
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByText("17 sem.", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  await page.getByRole("button", { name: "Passage en ponte" }).click();
  await page.getByLabel("Bâtiment de ponte").selectOption({ label: "Ferme Sidi Hajjaj · Bâtiment P1" });
  await page.getByLabel("Poules transférées").fill("4700");
  await expect(page.getByText("100 non transférées seront réformées ce jour-là.")).toBeVisible();
  await page.getByRole("button", { name: "Transférer" }).click();
  await page.getByRole("link", { name: "Toutes les bandes" }).click();
  await expect(page.getByText("Pondeuse · Ferme Sidi Hajjaj · Bâtiment P1 · Lohmann Brown")).toBeVisible();
  await expect(page.getByText("17 sem.", { exact: true })).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const batches = async () =>
    await query<{ species: string; status: string; age: number; culled: number | null }>(
      `SELECT b.species, b.status, b."ageAtPlacementDays" AS age, (SELECT sum(culled)::int FROM "DailyEntry" d WHERE d."batchId" = b.id) AS culled
       FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $1 ORDER BY b.species`,
      [e164],
    );
  await expect.poll(batches).toEqual([{ species: "layer", status: "open", age: 119, culled: null }, { species: "pullet", status: "closed", age: 119, culled: 100 }]);
});

// T64 acceptance (SPEC-m3 V7, P-Beldi): a band sold by the head offline, roosters and hens at their own price.
test("a beldi band sold by the head: 6 roosters and 4 hens, 790,00 DH", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Vente à la Tête");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), run: crypto.randomUUID(), band: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.run, farmId: ids.farm, name: "Parcours", areaM2: 2000, capacity: 1000, type: "open" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.band, houseId: ids.run, species: "beldi", strainId: "unspecified-beldi", placedOn: farmDaysAgo(3), chicksPlaced: 140, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: 154 },
    },
  ]);
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await expect(page.getByLabel("À la tête")).toBeChecked(); // beldi: per head by default
  await page.getByLabel("Nom de l’acheteur").fill("Client de passage");
  await page.getByLabel("Coqs", { exact: true }).fill("6");
  await page.getByLabel("Prix par tête · Coqs (DH)").fill("85,00");
  await page.getByLabel("Poules", { exact: true }).fill("4");
  await page.getByLabel("Prix par tête · Poules (DH)").fill("70,00");
  await expect(page.getByText(/790,00.DH/)).toBeVisible();
  await page.getByLabel("Montant reçu maintenant (DH)").fill("790");
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();
  await expect(page.getByText(/Client de passage · 10 sujets à la tête/)).toBeVisible();
  await expect(page.getByText(/Oiseaux présents : 130/).first()).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const sold = async () =>
    await query<{ kind: string; amount: string; birds: number }>(
      `SELECT s.kind, s."amountCentimes"::text AS amount, s.birds FROM "Sale" s JOIN "Membership" m ON m."organizationId" = s."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(sold).toEqual([{ kind: "perHead", amount: "79000", birds: 10 }]);
});

// T66 acceptance (SPEC-m3 D1, P-Owner): the home shows every type: broilers by day with their FCR, pullets with their
// uniformity, layers with their laying rate and yesterday's eggs, beldi bands in weeks.
test("the home shows a broiler batch, a layer batch with yesterday's eggs and a beldi band", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Vue d’Ensemble");
  await scopeRemembered(page);
  const ids = {
    farm: crypto.randomUUID(), b1: crypto.randomUUID(), p1: crypto.randomUUID(), run: crypto.randomUUID(), layers: crypto.randomUUID(),
    p2: crypto.randomUUID(), broilers: crypto.randomUUID(), pullets: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID(),
  };
  const place = (id: string, houseId: string, species: string, strainId: string, birds: number, age: number) => ({
    type: "flock.placeBatch",
    payload: { id, houseId, species, strainId, placedOn: farmDaysAgo(3), chicksPlaced: birds, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null, ageAtPlacementDays: age },
  });
  const house = (id: string, name: string) => ({ type: "farm-registry.createHouse", payload: { id, farmId: ids.farm, name, areaM2: 1000, capacity: 12000, type: "closed" } });
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    house(ids.b1, "Bâtiment 2"),
    house(ids.p1, "Bâtiment P1"),
    house(ids.run, "Parcours"),
    place(ids.broilers, ids.b1, "broiler", "ross-308", 12000, 0),
    house(ids.p2, "Bâtiment P2"),
    place(ids.pullets, ids.p2, "pullet", "lohmann-brown", 4800, 77),
    place(ids.layers, ids.p1, "layer", "lohmann-brown", 6000, 266),
    place(crypto.randomUUID(), ids.run, "beldi", "unspecified-beldi", 140, 147),
    // P-EggCollect's collection, yesterday: 1 713 eggs.
    { type: "eggs.recordCollection", payload: { id: uuidv7(), batchId: ids.layers, day: farmDaysAgo(1), counts: { normal: 1642, cracked: 18, dirty: 31, doubleYolk: 6, floor: 12, broken: 4 }, sample: null } },
    // Broilers: 600 kg of feed, then 12 000 birds at 100 g = 1 200 kg → IC 0,50. Pullets: mean 1 000 g, 5 of 6 within ±10 %.
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Provende Atlas", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: farmDaysAgo(10), quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
    { type: "flock.recordDay", payload: { batchId: ids.broilers, day: farmDaysAgo(1), changes: { dead: 0, feed: { stockItemId: ids.feed, grams: 600_000 } } } },
    { type: "flock.recordWeighing", payload: { id: uuidv7(), batchId: ids.broilers, day: farmDaysAgo(1), sample: { totalGrams: 10_000, count: 100 } } },
    { type: "flock.recordWeighing", payload: { id: uuidv7(), batchId: ids.pullets, day: farmDaysAgo(1), sample: { weightsGrams: [950, 1000, 1050, 1100, 880, 1020] } } },
  ]);
  await page.goto("/fr/dashboard");
  await expect(page.getByText("IC 0,50", { exact: true })).toBeVisible();
  await expect(page.getByText("Homogénéité 83,3 %", { exact: true })).toBeVisible();
  // D1: the latest weighing's average; no curve is seeded (OQ5), so no gap to the standard.
  await expect(page.getByText("Poids moyen 0,1 kg", { exact: true })).toBeVisible(); // broilers: 10 kg ÷ 100 birds
  await expect(page.getByText("Poids moyen 1 kg", { exact: true })).toBeVisible(); // pullets: 6 000 g ÷ 6
  await expect(page.getByText(/Œufs ramassés hier/).locator("..")).toContainText(/1.713/);
  await expect(page.getByText(/Ponte 28,5 % · 1.713 œufs le dernier jour ramassé/)).toBeVisible(); // 1 713 ÷ 6 000 = 28,549…
  await expect(page.getByText("Jour 3 sur 42")).toBeVisible();
  await expect(page.getByText("38 sem. 3 j", { exact: true })).toBeVisible(); // layers: 266 + 3 days
  await expect(page.getByText("21 sem. 3 j", { exact: true })).toBeVisible(); // the beldi band: 147 + 3 days
});

// T67 acceptance (SPEC-m3 D2, P-Compare): two closed broiler batches side by side with their figures, offline. The cost
// per kg is FN13's, read online (SPEC-finance §9 "One cost per kg").
test("closed broiler batches compared side by side", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Comparaison");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID(), buyer: crypto.randomUUID() };
  const batch = (placedDaysAgo: number, dead: number, kg: number, hatchery: string, vetCentimes?: string) => {
    const id = crypto.randomUUID();
    const vet = { id: crypto.randomUUID(), day: farmDaysAgo(placedDaysAgo - 10), category: "vet_fees", amountCentimes: vetCentimes, paidFrom: "credit", treasuryId: null, note: null, batchId: id, serviceMonth: null };
    return [
      { type: "flock.placeBatch", payload: { id, houseId: ids.house, strainId: "ross-308", placedOn: farmDaysAgo(placedDaysAgo), chicksPlaced: 100, deadOnArrival: 0, hatchery, deliveryNote: "BL", chickUnitPriceCentimes: "500", dayOldWeightGrams: 42 } },
      { type: "flock.recordDay", payload: { batchId: id, day: farmDaysAgo(placedDaysAgo - 3), changes: { dead, feed: { stockItemId: ids.feed, grams: 420_000 } } } },
      ...(vetCentimes ? [{ type: "finance.recordExpense", payload: vet }] : []), // a direct charge of the batch (FN13)
      {
        type: "sales.recordSale",
        payload: { id: crypto.randomUUID(), batchId: id, buyerId: ids.buyer, day: farmDaysAgo(placedDaysAgo - 42), birds: 100 - dead, farmWeightGrams: kg * 1000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "cash", paidCentimes: "0", instrument: null },
      },
    ];
  };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme El Kheir", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 3", areaM2: 1000, capacity: 12000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Provende Atlas", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day: farmDaysAgo(100), quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Abattoir", phone: null, type: "abattoir" } },
    ...batch(90, 2, 245, "Couvoir Chaouia", "24500"), // 98 sold, 2,5 kg each; 420 kg of feed → IC 1,71; a 245 DH vet bill
    ...batch(45, 4, 230, "Couvoir B"), // 96 sold, 2,4 kg each; IC 1,83
  ]);
  await page.goto("/fr/compare");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByRole("table", { name: "Indicateurs par lot clôturé" })).toBeVisible();
  // Online, FN13's cost per kg, as /results: chicks 500 + feed 1 890 (+ the vet bill 245) DH over the kg sold.
  const online = page.getByRole("table", { name: "Indicateurs par lot clôturé" }).getByRole("row");
  await expect(online.filter({ hasText: "Couvoir Chaouia" })).toContainText(/10,76\sDH/); // 2 635 ÷ 245; B6 locked 9,76 (no vet bill)
  await expect(online.filter({ hasText: "Couvoir B" })).toContainText(/10,39\sDH/); // 2 390 ÷ 230
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  const rows = page.getByRole("table", { name: "Indicateurs par lot clôturé" }).getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("Couvoir B");
  await expect(rows.nth(1)).toContainText("96,0 %");
  await expect(rows.nth(1)).toContainText("1,83");
  await expect(rows.nth(2)).toContainText("Couvoir Chaouia");
  await expect(rows.nth(2)).toContainText("1,71");
  await expect(rows.nth(2)).toContainText("42 j");
  // P-Compare "Couvoirs": day-7 deaths over the chicks, day-old weight, no claim without a farm threshold
  const hatcheries = page.getByRole("table", { name: "Couvoirs · qualité du poussin" }).getByRole("row");
  await expect(hatcheries.filter({ hasText: "Couvoir B" })).toContainText(/1\s*42 g\s*4,0 %\s*0/);
  await expect(hatcheries.filter({ hasText: "Couvoir Chaouia" })).toContainText(/1\s*42 g\s*2,0 %\s*0/);
});
