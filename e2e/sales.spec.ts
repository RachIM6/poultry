import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T21 acceptance (browser part): offline, a sale on a day under withdrawal is refused with the explanation; the same
// sale dated before the treatment began is recorded, with its amount and weighing gap, and lowers birds on hand while
// the batch stays open. Withdrawal days are made up for the test: the real ones come from each medicine's label (OQ4).
test("an offline sale is refused during a withdrawal, then recorded for a day before it, lowering birds on hand", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Ventes");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20));
  const medicine = crypto.randomUUID();
  await pushAs(page, [
    { type: "inventory.createStockItem", payload: { id: medicine, farmId: ids.farm, productId: null, kind: "medicine", name: "Amoxicilline", unit: "ml", lot: "AMX-1", expiresOn: farmDaysAgo(-365) } },
    {
      // from 3 days ago to yesterday, + 3 days: runs until the day after tomorrow
      type: "health.recordTreatment",
      payload: { id: uuidv7(), batchId: ids.batch, stockItemId: medicine, quantity: 100, dose: "1 ml/L", startOn: farmDaysAgo(3), endOn: farmDaysAgo(1), reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 3 },
    },
  ]);

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByText("Délai d’attente en cours")).toBeVisible();
  await expect(page.getByText("Oiseaux présents : 1 000")).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await page.getByLabel("Nom de l’acheteur").fill("Abattoir Atlas");
  await page.getByLabel("Type d’acheteur").selectOption({ label: "Abattoir" });
  await page.getByLabel("Nombre d’oiseaux").fill("300");
  await page.getByLabel("Poids à la ferme (kg)").fill("600");
  await page.getByLabel("Poids de l’acheteur (kg, facultatif)").fill("588");
  await expect(page.getByText(/Écart de pesée\s:\s12\skg/)).toBeVisible();
  await page.getByLabel("Prix au kg (DH)").fill("14,50");
  await expect(page.getByText(/^Montant\s:\s8.700,00\sDH$/)).toBeVisible(); // 600 kg × 14,50
  await page.getByLabel("Montant reçu maintenant (DH)").fill("8700");
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Vente refusée\s:\sun délai d’attente/ })).toBeVisible();

  await page.getByLabel("Date de la vente").fill(farmDaysAgo(4)); // before the treatment began
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();
  const sales = page.getByRole("list", { name: "Ventes" }).getByRole("listitem");
  await expect(sales).toHaveCount(1);
  await expect(sales.nth(0)).toContainText("Abattoir Atlas · 300 oiseaux · 600 kg");
  await expect(page.getByText("Oiseaux présents : 700")).toBeVisible();

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Oiseaux présents : 700")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ amount: string; birds: number; status: string }>(
      `SELECT s."amountCentimes"::text AS amount, sb.birds, b.status
       FROM "Sale" s JOIN "SoldBirds" sb ON sb.id = s.id JOIN "Batch" b ON b.id = s."batchId"
       JOIN "Membership" m ON m."organizationId" = s."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ amount: "870000", birds: 300, status: "open" }]);
});
