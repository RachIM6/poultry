import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T19 acceptance (browser part): a batch placed offline gets its vaccination plan from the farm's protocol, and a
// vaccine marked done offline takes its doses out of the lot. The dates and the reminders are checked on the server:
// src/modules/health/vaccinations.int.test.ts. The protocol is made up for the test, NOT a schedule (OQ4).
test("placing a batch offline plans its vaccinations, and marking one done deducts the lot", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Vaccins");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), supplier: crypto.randomUUID(), lot: crypto.randomUUID(), protocol: crypto.randomUUID() };
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Véto Atlas", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.lot, farmId: ids.farm, productId: "vaccine-newcastle", kind: "vaccine", name: "Newcastle", unit: "dose", lot: "NDV-26", expiresOn: farmDaysAgo(-365) } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: ids.supplier, stockItemId: ids.lot, day: farmDaysAgo(0), quantity: 2000, unitPriceCentimes: "20", paidCentimes: "0", dueOn: null } },
    { type: "reference-data.copyProtocol", payload: { id: ids.protocol, templateId: "broiler-default", name: "Programme de la ferme" } },
    {
      type: "reference-data.updateProtocol",
      payload: { id: ids.protocol, changes: { items: [{ dayOfAge: 0, productId: "vaccine-newcastle", method: "spray" }, { dayOfAge: 7, productId: "vaccine-gumboro", method: "drinkingWater" }] } },
    },
  ]);

  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await expect(page.getByLabel("Programme de vaccination")).toHaveValue(ids.protocol); // pulled, preselected
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByLabel("Poussins placés").fill("1000");
  await page.getByLabel("Morts à l’arrivée").fill("10");
  await page.getByLabel("Couvoir").fill("Couvoir Atlas");
  await page.getByLabel("N° de bon de livraison").fill("BL-0412");
  await page.getByLabel("Prix d’un poussin (DH)").fill("4,50");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("link", { name: "Saisir le jour" }).click();

  const plan = page.getByRole("list", { name: "Vaccinations" }).getByRole("listitem");
  await expect(plan).toHaveCount(2);
  await expect(plan.nth(0)).toContainText("Jour 0 · Vaccin maladie de Newcastle · Nébulisation");
  await expect(plan.nth(0)).toContainText("Aujourd’hui");
  await expect(plan.nth(1)).toContainText("Jour 7 · Vaccin Gumboro · Eau de boisson");
  await expect(plan.nth(1)).toContainText("Prévu le");

  await plan.nth(0).getByRole("button", { name: "Marquer comme fait" }).click();
  await expect(page.getByLabel("Doses")).toHaveValue("990"); // the birds on hand
  await expect(page.getByLabel("Lot de vaccin")).toContainText("NDV-26");
  await page.getByRole("button", { name: "Enregistrer la vaccination" }).click();
  await expect(plan.nth(0)).toContainText("lot NDV-26 · 990 doses");

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("list", { name: "Vaccinations" }).getByRole("listitem").nth(0)).toContainText("lot NDV-26 · 990 doses");

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ due: string; doses: number | null; stock: number }>(
      `SELECT v."dueOn"::text AS due, v.doses,
              (SELECT SUM(s.quantity)::int FROM "StockMovement" s WHERE s."stockItemId" = $2) AS stock
       FROM "Vaccination" v JOIN "Membership" m ON m."organizationId" = v."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $1 ORDER BY v."dueOn"`,
      [e164, ids.lot],
    );
  await expect.poll(server).toEqual([
    { due: farmDaysAgo(0), doses: 990, stock: 1010 },
    { due: farmDaysAgo(-7), doses: null, stock: 1010 },
  ]);
});
