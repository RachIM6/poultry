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
