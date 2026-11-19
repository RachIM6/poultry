import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T20 acceptance (browser part): the withdrawal banner shows while a withdrawal runs and is gone once it has ended; a
// treatment and a vet visit recorded offline. The dates themselves are unit-tested (src/modules/health/domain).
// Withdrawal days are made up for the test: the real ones come from each medicine's label (OQ4).
test("a treatment recorded offline shows the withdrawal banner; an ended withdrawal shows none", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Traitements");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20));
  const medicine = crypto.randomUUID();
  await pushAs(page, [
    { type: "inventory.createStockItem", payload: { id: medicine, farmId: ids.farm, productId: null, kind: "medicine", name: "Amoxicilline", unit: "ml", lot: "AMX-1", expiresOn: farmDaysAgo(-365) } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: ids.supplier, stockItemId: medicine, day: farmDaysAgo(20), quantity: 1000, unitPriceCentimes: "50", paidCentimes: "0", dueOn: null } },
    {
      // ended 12 days ago + 5 days of withdrawal: over a week ago
      type: "health.recordTreatment",
      payload: { id: crypto.randomUUID(), batchId: ids.batch, stockItemId: medicine, quantity: 200, dose: "1 ml/L", startOn: farmDaysAgo(15), endOn: farmDaysAgo(12), reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 5 },
    },
  ]);

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  const treatments = page.getByRole("list", { name: "Traitements" }).getByRole("listitem");
  await expect(treatments).toHaveCount(1); // pulled
  await expect(treatments.nth(0)).toContainText("Délai d’attente 5 j");
  const banner = page.getByText("Délai d’attente en cours");
  await expect(banner).toHaveCount(0); // ended: no banner

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Ajouter un traitement" }).click();
  await expect(page.getByLabel("Médicament")).toContainText("Amoxicilline · lot AMX-1");
  await page.getByLabel("Quantité utilisée (ml)").fill("250");
  await page.getByLabel("Dose prescrite").fill("1 ml par litre d’eau");
  await page.getByLabel("Motif").fill("Colibacillose");
  await page.getByLabel("Prescrit par").fill("Dr Alaoui");
  await page.getByLabel("Délai d’attente viande (jours)").fill("3");
  await page.getByRole("button", { name: "Enregistrer le traitement" }).click();
  await expect(treatments).toHaveCount(2);
  await expect(banner).toBeVisible(); // today + 3 days

  await page.getByRole("button", { name: "Ajouter une visite" }).click();
  await page.getByLabel("Vétérinaire", { exact: true }).fill("Dr Alaoui");
  await page.getByLabel("Notes", { exact: true }).fill("Toux, traitement prescrit.");
  await page.getByRole("button", { name: "Enregistrer la visite" }).click();
  await expect(page.getByRole("list", { name: "Visites vétérinaires" }).getByRole("listitem")).toContainText("Dr Alaoui");

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Délai d’attente en cours")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ ends: string; visits: number; stock: number }>(
      `SELECT t."withdrawalEndsOn"::text AS ends,
              (SELECT COUNT(*)::int FROM "VetVisit" v WHERE v."batchId" = t."batchId") AS visits,
              (SELECT SUM(s.quantity)::int FROM "StockMovement" s WHERE s."stockItemId" = $2) AS stock
       FROM "Treatment" t JOIN "Membership" m ON m."organizationId" = t."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $1 ORDER BY t."withdrawalEndsOn"`,
      [e164, medicine],
    );
  await expect.poll(server).toEqual([
    { ends: farmDaysAgo(7), visits: 1, stock: 550 }, // 1 000 − 200 − 250
    { ends: farmDaysAgo(-3), visits: 1, stock: 550 },
  ]);
});
