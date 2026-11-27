import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T111 (browser part): the owner records a bank statement, ticks the lines that are on it and sees "Rapproché".
// Roles, locked months and one statement per line: src/modules/finance/bank.int.test.ts.
test("a bank statement is reconciled by ticking its lines", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage du Rapprochement");
  await scopeRemembered(page);
  const ids = { bank: crypto.randomUUID(), box: crypto.randomUUID() };
  await pushAs(page, [
    { type: "finance.createTreasuryAccount", payload: { id: ids.bank, kind: "bank", name: "Banque Populaire" } },
    { type: "finance.createTreasuryAccount", payload: { id: ids.box, kind: "cash", name: "Caisse ferme" } },
    { type: "finance.recordTransfer", payload: { id: crypto.randomUUID(), day: farmDaysAgo(3), amountCentimes: "1000000", fromId: ids.box, toId: ids.bank } },
    { type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(2), category: "electricity", amountCentimes: "120000", paidFrom: "bank", treasuryId: ids.bank, note: null } },
    { type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(1), category: "water", amountCentimes: "30000", paidFrom: "bank", treasuryId: ids.bank, note: null } },
  ]);

  await page.goto("/fr/treasury");
  await page.getByRole("navigation", { name: "Trésorerie" }).getByRole("link", { name: "Rapprochement" }).click(); // the section's tab
  await expect(page.getByText("Aucun relevé pour ce compte.")).toBeVisible();

  // The statement as printed: the deposit and the electricity bill are on it, the water bill isn't yet. Its form opens
  // in a sheet that closes once saved.
  await page.getByRole("button", { name: "Ajouter un relevé" }).click();
  await page.getByLabel("Date de fin du relevé").fill(farmDaysAgo(0));
  await page.getByLabel("Solde final du relevé (DH)").fill("8 800,00");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  const status = page.getByRole("status").filter({ hasText: /rapproché/i });
  await expect(status).toHaveText("Non rapproché");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const figures = page.getByRole("definition");
  await expect(figures.nth(1)).toHaveText(/8.500,00\sDH/); // book balance: 10 000 − 1 200 − 300
  await expect(figures.nth(3)).toHaveText(/8.800,00\sDH/); // nothing ticked yet

  const row = (text: string | RegExp) => page.getByRole("row").filter({ hasText: text });
  const [deposit, power, water] = [row("Virement de fonds"), row(/1.200,00/), row(/300,00/)];
  const filter = page.getByRole("navigation", { name: "Opérations à afficher" });
  await expect(filter.getByRole("link", { name: "À pointer 3" })).toHaveAttribute("aria-current", "page"); // the default
  for (const line of [deposit, power]) {
    await line.getByRole("button", { name: /^Pointer : / }).click(); // WCAG 2.4.6: the line in the name
    await expect(line).toHaveCount(0); // ticked: no longer « À pointer »
  }
  await expect(status).toHaveText("Rapproché");
  await filter.getByRole("link", { name: /^Toutes/ }).click();
  for (const line of [deposit, power]) await expect(line.getByRole("button", { name: "Dépointer" })).toBeVisible();
  await expect(figures.nth(3)).toHaveText(/^0,00\sDH$/);
  await expect(water.getByRole("button", { name: "Pointer" })).toBeVisible(); // not at the bank yet

  // A tick is undone until its month is locked.
  await deposit.getByRole("button", { name: "Dépointer" }).click();
  await expect(status).toHaveText("Non rapproché");
});

// FC9: a line of an imported statement that isn't in the books opens the form that books it, prefilled: a debit as bank
// fees on /expenses, the rest as the owner's manual entry on /books, its 5141 line on the statement's bank account.
test("an imported line absent from the books opens its form prefilled", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Frais Bancaires");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);
  await scopeRemembered(page);
  const bank = crypto.randomUUID();
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: bank, kind: "bank", name: "Banque Populaire" } }]);
  const [feeDay, inDay] = [farmDaysAgo(2), farmDaysAgo(1)];
  const printed = (d: string) => d.split("-").reverse().join("/");
  const csv = `Date;Libellé;Débit;Crédit
${printed(feeDay)};FRAIS TENUE DE COMPTE;45,00;
${printed(inDay)};VIREMENT RECU;;500,00
`;

  await page.goto("/fr/treasury/bank");
  await page.getByRole("button", { name: "Importer un relevé (fichier)" }).click();
  const upload = page.getByRole("dialog", { name: "Importer un relevé (fichier)" });
  await upload.getByLabel("CSV (tableur)").check();
  await upload.getByLabel("Fichier").setInputFiles({ name: "releve.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await upload.getByLabel("Date de fin du relevé").fill(farmDaysAgo(0));
  await upload.getByLabel("Solde final du relevé (DH)").fill("455,00");
  await upload.getByRole("button", { name: "Aperçu" }).click();
  await upload.getByRole("button", { name: "Importer", exact: true }).click();

  const row = (text: string) => page.getByRole("row").filter({ hasText: text });
  await expect(row("FRAIS TENUE DE COMPTE")).toContainText("Absente des livres");
  await row("FRAIS TENUE DE COMPTE").getByRole("link", { name: "Enregistrer en frais bancaires" }).click();
  await expect(page.getByLabel("Nature")).toHaveValue("bank_fees");
  await expect(page.getByLabel("Montant (DH)")).toHaveValue("45.00");
  await expect(page.getByLabel("Payé avec")).toHaveValue(bank);
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(feeDay);

  await page.goBack();
  await row("VIREMENT RECU").getByRole("link", { name: "Passer une écriture manuelle" }).click();
  const form = page.getByRole("dialog", { name: "Écriture manuelle" }); // open at once on /books
  await expect(form.getByLabel("Date")).toHaveValue(inDay);
  await expect(form.getByLabel("Libellé")).toHaveValue("VIREMENT RECU");
  await expect(form.getByLabel("Compte, ligne 1")).toHaveValue("5141");
  await expect(form.getByLabel("Débit, ligne 1")).toHaveValue("500.00");
  await expect(form.getByLabel("Compte bancaire ou caisse, ligne 1")).toHaveValue(bank);
});
