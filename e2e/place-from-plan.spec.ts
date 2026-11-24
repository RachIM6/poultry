import { expect, test } from "@playwright/test";
import { farmDaysAgo, outboxEmpty, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T98 (SPEC-m5 PL3): a plan for today is placed offline from /planning; the house then shows the batch with the
// plan's sale day, and online one batch is placed and the plan is marked placed.
test("a planned batch is placed offline from its plan, and the batch keeps the plan's sale day", async ({ page, context }) => {
  test.setTimeout(150_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Mise en Place");
  await scopeRemembered(page);
  const [farm, house] = [crypto.randomUUID(), crypto.randomUUID()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: house, farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "planning.savePlan", payload: { id: crypto.randomUUID(), houseId: house, placeOn: farmDaysAgo(0), chicks: 10000, strainId: "ross-308", hatchery: "Couvoir X", chickPriceCentimes: "450", saleAge: 35 } },
  ]);

  await page.goto("/fr/planning");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  const lines = page.getByRole("list", { name: "Lots de Bâtiment 1" }).getByRole("listitem");
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText("10000 poussins · Couvoir X");

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await lines.getByRole("button", { name: /^Mettre en place le lot prévu le/ }).click();
  const form = page.getByRole("form", { name: /^Mettre en place le lot prévu le/ });
  await expect(form.getByLabel("Prix d’un poussin (DH)")).toHaveValue("4,50"); // from the booking
  await form.getByLabel("Morts à l’arrivée").fill("12");
  await form.getByLabel("N° de bon de livraison").fill("BL-77");
  await form.getByRole("button", { name: "Mettre en place", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/^Enregistré sur ce téléphone/);
  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText("Lot en place depuis le");
  await expect(lines).toContainText("Vente vers le"); // the plan's sale age, kept by the batch

  const reload = await page.reload(); // still offline: kept on the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(lines).toContainText("Lot en place depuis le");

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ batches: number; status: string; linked: boolean }>(
      `SELECT (SELECT count(*)::int FROM "Batch" b WHERE b."houseId" = $1) AS batches, p.status, p."batchId" IS NOT NULL AS linked
       FROM "PlannedBatch" p JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $2`,
      [house, e164],
    );
  await expect.poll(server).toEqual([{ batches: 1, status: "placed", linked: true }]);
});
