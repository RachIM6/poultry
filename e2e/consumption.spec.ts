import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, farmWithBatch, login, outboxEmpty, ownerWithFarm, pushAs, query, randomMobile, referenceCached, scopeRemembered } from "./auth";

// T112 acceptance (browser part, SPEC-finance FC7): offline, a home consumption on the sale form is prefilled with the
// last sale's price, refused during a withdrawal, then recorded for a day before it, lowering birds on hand; it syncs
// once, with no buyer and no payment. The exploitant's own posts on 1117 Capital personnel (FQ11). Withdrawal days are
// made up for the test (OQ4).
test("an offline home consumption is refused during a withdrawal, then recorded and synced once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Consommation");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20));
  const [medicine, buyer] = [crypto.randomUUID(), uuidv7()];
  await pushAs(page, [
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    // 100 birds, 200 kg at 14,50 DH/kg, before the treatment
    { type: "sales.recordSale", payload: { id: uuidv7(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(5), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "cash", paidCentimes: "290000", instrument: null } },
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
  await expect(page.getByText("Oiseaux présents : 900")).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await page.getByRole("radio", { name: "Consommation" }).check();
  await expect(page.getByLabel("Prix au kg (DH)")).toHaveValue("14,50"); // FQ21: the last sale's
  await expect(page.getByLabel("Montant reçu maintenant (DH)")).toHaveCount(0); // no payment
  await page.getByLabel("Pris par").selectOption({ label: "Un employé" });
  await page.getByLabel("Nombre d’oiseaux").fill("5");
  await page.getByLabel("Poids à la ferme (kg)").fill("10");
  await expect(page.getByText(/^Valeur\s:\s145,00\sDH$/)).toBeVisible(); // 10 kg × 14,50
  await page.getByRole("button", { name: "Enregistrer la consommation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /un délai d’attente/ })).toBeVisible();

  await page.getByLabel("Date de la vente").fill(farmDaysAgo(4)); // before the treatment began
  await page.getByRole("button", { name: "Enregistrer la consommation" }).click();
  await expect(page.getByRole("list", { name: "Ventes" }).getByRole("listitem").filter({ hasText: "Consommation · Un employé · 5 oiseaux" })).toHaveCount(1);
  await expect(page.getByText("Oiseaux présents : 895")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = async () =>
    await query<{ buyer: string | null; takenBy: string; amount: string; method: string; birds: number }>(
      `SELECT s."buyerId" AS buyer, s."takenBy", s."amountCentimes"::text AS amount, s."paymentMethod" AS method, sb.birds
       FROM "Sale" s JOIN "SoldBirds" sb ON sb.id = s.id
       JOIN "Membership" m ON m."organizationId" = s."organizationId" JOIN "User" u ON u.id = m."userId"
       WHERE u."phoneNumber" = $1 AND s."takenBy" IS NOT NULL`,
      [e164],
    );
  await expect.poll(server).toEqual([{ buyer: null, takenBy: "employee", amount: "14500", method: "none", birds: 5 }]);

  // FQ11: what the individual exploitant takes is a withdrawal in kind, D 1117 Capital personnel / C 7140, and nothing
  // is left unposted on the books
  const exploitant = uuidv7();
  await pushAs(page, [{ type: "sales.recordConsumption", payload: { id: exploitant, batchId: ids.batch, day: farmDaysAgo(4), takenBy: "exploitant", kind: "live", birds: 2, farmWeightGrams: 4_000, pricePerKgCentimes: null } }]);
  const lines = async () =>
    await query<{ account: string; debit: string; credit: string }>(
      `SELECT l.account, l."debitCentimes"::text AS debit, l."creditCentimes"::text AS credit FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."entryId" WHERE j."sourceId" = $1 ORDER BY l."debitCentimes" DESC`,
      [exploitant],
    );
  await expect.poll(lines).toEqual([{ account: "1117", debit: "5800", credit: "0" }, { account: "7140", debit: "0", credit: "5800" }]); // 4 kg × 14,50
  await page.goto(`/fr/books?month=${farmDaysAgo(4).slice(0, 7)}`);
  await expect(page.getByRole("region", { name: "Consommations non comptabilisées" })).toHaveCount(0);
});

// T112, I5: a worker records a consumption with no price field and no value, sees none of the farm's sales to buyers,
// and the server prices it from the last sale.
test("a worker records a consumption without seeing a price, an amount or the buyers' sales; the server prices it", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage du Gardien");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20));
  const buyer = uuidv7();
  await pushAs(page, [
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    { type: "sales.recordSale", payload: { id: uuidv7(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(5), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1450", paymentMethod: "cash", paidCentimes: "290000", instrument: null } },
  ]);

  // The owner invites the worker, who signs in once (the invitation becomes a membership).
  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  const workerContext = await browser.newContext({ ...test.info().project.use });
  const worker = await workerContext.newPage();
  const e164 = await login(worker, "fr", phone);
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);
  await scopeRemembered(worker);

  await worker.goto(`/fr/batches#${ids.batch}`);
  await expect(worker.getByText("Oiseaux présents : 900")).toBeVisible();
  await expect(worker.getByText("Aucune vente.")).toBeVisible(); // the sale to Abattoir Atlas isn't the worker's
  await expect(worker.getByRole("button", { name: "Nouvelle vente" })).toHaveCount(0);
  await worker.getByRole("button", { name: "Nouvelle consommation" }).click();
  await expect(worker.getByRole("radio", { name: "Consommation" })).toHaveCount(0); // a consumption, nothing else
  await expect(worker.getByLabel("Prix au kg (DH)")).toHaveCount(0);
  await expect(worker.getByLabel("Montant reçu maintenant (DH)")).toHaveCount(0);
  await worker.getByLabel("Pris par").selectOption({ label: "Un employé" });
  await worker.getByLabel("Nombre d’oiseaux").fill("5");
  await worker.getByLabel("Poids à la ferme (kg)").fill("10");
  await expect(worker.getByText(/^Valeur\s:/)).toHaveCount(0);
  await worker.getByRole("button", { name: "Enregistrer la consommation" }).click();

  const sales = worker.getByRole("list", { name: "Ventes" }).getByRole("listitem");
  await expect(sales).toHaveCount(1);
  await expect(sales).toContainText("Consommation · Un employé · 5 oiseaux");
  await expect(worker.getByText("Oiseaux présents : 895")).toBeVisible();
  await outboxEmpty(worker);

  // On the server, priced from the last sale: 10 kg × 14,50 DH.
  const server = async () =>
    await query<{ takenBy: string; amount: string; recordedBy: string }>(
      `SELECT s."takenBy", s."amountCentimes"::text AS amount, u."phoneNumber" AS "recordedBy"
       FROM "Sale" s JOIN "User" u ON u.id = s."recordedBy" WHERE u."phoneNumber" = $1 AND s."takenBy" IS NOT NULL`,
      [e164],
    );
  await expect.poll(server).toEqual([{ takenBy: "employee", amount: "14500", recordedBy: e164 }]);

  // Once the phone has pulled it back, still no value nor the buyers' sale.
  await worker.reload();
  await expect(sales).toHaveCount(1);
  await expect(sales).toContainText("Consommation · Un employé · 5 oiseaux");
  await expect(worker.getByText(/Valeur\s:|Abattoir Atlas/)).toHaveCount(0);
  await workerContext.close();
});
