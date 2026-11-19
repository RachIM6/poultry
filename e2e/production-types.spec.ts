import { expect, test } from "@playwright/test";
import { ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

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

  await context.unroute("**");
  await context.setOffline(false);
  const batches = async () =>
    await query<{ species: string; age: number }>(
      `SELECT b.species, b."ageAtPlacementDays" AS age FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND b.status = 'open' ORDER BY b."ageAtPlacementDays"`,
      [e164],
    );
  await expect.poll(batches).toEqual([{ species: "beldi", age: 21 }, { species: "layer", age: 126 }, { species: "beldi", age: 154 }]);

  await page.goto("/ar/batches");
  await expect(page.getByText("18 أسبوع", { exact: true })).toBeVisible();
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
  await page.getByRole("link", { name: /Même lot, (mâles : 1 496|femelles : 1 500) sujets/ }).click();
  await expect(page.getByRole("link", { name: /Même lot, (mâles : 1 496|femelles : 1 500) sujets/ })).toBeVisible();

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
