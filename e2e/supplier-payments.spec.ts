import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// S2, SPEC-finance FN6: a supplier paid later, offline, lowers what is owed; once synced, the cheque leaves the bank.
test("a supplier paid by cheque offline owes less, after a reload and on the server", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Fournisseurs");
  await scopeRemembered(page);
  const [farm, item, supplier] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "inventory.createSupplier", payload: { id: supplier, name: "Alf Sahel", phone: null } },
    { type: "inventory.createStockItem", payload: { id: item, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    // 9 000,00 DH on credit
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: supplier, stockItemId: item, day: farmDaysAgo(1), quantity: 2_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
  ]);

  await page.goto("/fr/stock");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByText(/Reste dû : 9.000,00.DH/)).toBeVisible();
  const dues = page.getByRole("list", { name: "Échéances de Alf Sahel" }).getByRole("listitem");
  await expect(dues).toHaveText([/^9.000,00.DH en retard depuis le /]); // no due date: due on the purchase day (FN12)

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Payer Alf Sahel" }).click();
  const form = page.getByRole("form", { name: "Payer Alf Sahel" });
  await form.getByLabel("Montant payé (DH)").fill("9000,01");
  await form.getByLabel("Payé par").selectOption({ label: "Chèque émis" });
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(form.getByRole("alert")).toHaveText("Ce paiement dépasse ce qui est dû au fournisseur.");
  await form.getByLabel("Montant payé (DH)").fill("2000");
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Reste dû : 7.000,00.DH/)).toBeVisible();
  await expect(dues).toHaveText([/^7.000,00.DH en retard depuis le /]);

  const reload = await page.reload(); // still offline: the shell and the payment come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText(/Reste dû : 7.000,00.DH/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const lines = async () =>
    (
      await query<{ journal: string; account: string; debit: string; credit: string }>(
        `SELECT j.journal::text, l.account, l."debitCentimes"::text AS debit, l."creditCentimes"::text AS credit FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."entryId"
         JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND j.label = 'Paiement fournisseur' ORDER BY l.account`,
        [e164],
      )
    ).map((l) => `${l.journal} ${l.account} ${l.debit} ${l.credit}`);
  await expect.poll(lines, { timeout: 20_000 }).toEqual(["BQ 4411 200000 0", "BQ 5141 0 200000"]);
});
