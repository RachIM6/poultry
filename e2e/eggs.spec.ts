import { expect, test } from "@playwright/test";
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
