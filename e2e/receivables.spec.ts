import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T22 acceptance (browser part): what a buyer owes, their cheque with its due date, and later payments recorded offline,
// no more than what is owed. The balance rule is unit-tested; the due-date reminder is checked on the server
// (src/modules/sales/receivables.int.test.ts).
test("a buyer's balance and cheque show offline, and later payments bring it to zero", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Créances");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(30));
  const buyer = crypto.randomUUID();
  const sale = (payload: object) => ({
    type: "sales.recordSale",
    payload: { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(1), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", ...payload },
  });
  await pushAs(page, [
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    // 200 kg × 15 DH = 3 000 DH each: a cheque due in 10 days, and a credit with 500 DH paid
    sale({ paymentMethod: "cheque", paidCentimes: "0", instrument: { number: "0012345", dueOn: farmDaysAgo(-10) } }),
    sale({ paymentMethod: "credit", paidCentimes: "50000", instrument: null }),
  ]);

  await page.getByRole("link", { name: "Créances des acheteurs" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const owes = page.getByText(/^Abattoir Atlas doit/);
  await expect(owes).toHaveText(/doit 5.500,00\sDH$/); // pulled
  await expect(page.getByText(/^Chèque n° 0012345 : 3.000,00\sDH, échéance le/)).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const pay = async (amount: string) => {
    await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
    await page.getByLabel("Montant reçu (DH)").fill(amount);
    await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  };
  await pay("6000");
  await expect(page.getByRole("alert").filter({ hasText: "Ce paiement dépasse ce que l’acheteur doit." })).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await pay("2500");
  await expect(owes).toHaveText(/doit 3.000,00\sDH$/);

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(owes).toHaveText(/doit 3.000,00\sDH$/);
  await pay("3000");
  await expect(page.getByText("Aucun acheteur ne doit d’argent.")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ paid: string }>(
      `SELECT SUM(p."amountCentimes")::text AS paid FROM "BuyerPayment" p
       JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ paid: "550000" }]);
});
