import { expect, test } from "@playwright/test";
import { outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T39 (SPEC-finance FN9): a purchase's VAT, entered on the form, is booked apart for a VAT-registered entity.
test("a VAT-registered farm's purchase and quick expense book their VAT on 34552", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage de la TVA");
  await scopeRemembered(page);
  // No screen for the accounting choices yet: the owner's choice is set as changeAccountingChoices would.
  await query(
    `UPDATE "LegalEntity" SET "vatRegistered" = true WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`,
    [e164],
  );
  const [farm, item] = [crypto.randomUUID(), crypto.randomUUID()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "inventory.createStockItem", payload: { id: item, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
  ]);

  await page.goto("/fr/stock");
  await expect(page.getByText("En stock : 0 kg")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer un achat" }).click();
  await page.getByLabel("Nom du nouveau fournisseur").fill("Alf Sahel");
  await page.getByLabel("Quantité (kg)").fill("1000");
  await page.getByLabel("Prix par kg (DH)").fill("1,20");
  await page.getByLabel("Dont TVA (DH, facultatif)").fill("200");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/En stock : 1.000.kg/)).toBeVisible();
  await outboxEmpty(page);

  const lines = async () =>
    (
      await query<{ account: string; debit: string; credit: string }>(
        `SELECT l.account, l."debitCentimes"::text AS debit, l."creditCentimes"::text AS credit FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."entryId"
         JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY l.account`,
        [e164],
      )
    ).map((l) => `${l.account} ${l.debit} ${l.credit}`);
  await expect.poll(lines).toEqual(["34552 20000 0", "4411 0 120000", "612122 100000 0"]);

  // A quick expense's bill: 1 200,00 DH of electricity, 200,00 of it VAT.
  const box = crypto.randomUUID();
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: box, kind: "cash", name: "Caisse ferme" } }]);
  await page.goto("/fr/expenses");
  await page.getByLabel("Nature").selectOption({ label: "Électricité" });
  await page.getByLabel("Montant (DH)").fill("1200");
  await page.getByLabel("Dont TVA (DH, facultatif)").fill("200");
  await page.getByLabel("Payé avec").selectOption({ label: "Caisse · Caisse ferme" });
  await page.getByRole("button", { name: "Enregistrer la dépense" }).click();
  await expect(page.getByRole("list", { name: "Dernières dépenses" }).getByRole("listitem")).toHaveText([/^Électricité : 1.200,00\sDH, le/]); // saved on the phone
  await outboxEmpty(page);
  await expect.poll(lines).toEqual(["34552 20000 0", "34552 20000 0", "4411 0 120000", "5161 0 120000", "612122 100000 0", "612512 100000 0"]);
});
