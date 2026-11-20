import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { farmDaysAgo, login, ownerWithFarm, pushAs, query, randomMobile, scopeRemembered } from "./auth";
import { unzip } from "../src/test/unzip";

// T36 (FN16): an individual farmer (cash_book) sees their receipts-and-expenses book; the ledger views are tested on
// the server (src/modules/finance/books.int.test.ts).
test("an individual farmer's books are the receipts-and-expenses book", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Livres");
  await scopeRemembered(page);
  const box = crypto.randomUUID();
  await pushAs(page, [
    { type: "finance.createTreasuryAccount", payload: { id: box, kind: "cash", name: "Caisse" } },
    { type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(0), category: "water", amountCentimes: "45000", paidFrom: "cash", treasuryId: box, note: null, batchId: null, serviceMonth: null } },
  ]);
  const posted = async () =>
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0].n;
  await expect.poll(posted).toBe(1);

  await page.goto("/fr/dashboard");
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // tasks/plan-ui.md U2: the "Plus" tab
  await page.getByRole("link", { name: "Comptabilité" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Livre des recettes et dépenses");
  await expect(page.getByRole("link", { name: "Balance" })).toHaveCount(0); // a cash_book entity has no ledger views
  await expect(page.getByRole("link", { name: "Bilan (projet)" })).toHaveCount(0); // nor a balance sheet (T110)
  const book = page.getByRole("table", { name: "Recettes et dépenses" });
  await expect(book.getByRole("row").nth(1)).toContainText(/Dépense · Consommation d’Eau.*5161 Caisses.*450,00\sDH/);
  await expect(book.getByRole("row").last()).toContainText(/Total du mois\s*0,00\sDH\s*450,00\sDH/);

  // T38 (FN18): the month for the accountant, as a zip of CSV and Excel.
  const month = farmDaysAgo(0).slice(0, 7);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exporter pour le comptable (CSV, Excel)" }).click()]);
  expect(download.suggestedFilename()).toBe(`comptabilite-${month}.zip`);
  const files = unzip(await readFile(await download.path()));
  expect([...files.keys()]).toEqual([`recettes-depenses-${month}.csv`, `livres-${month}.xlsx`]);
  expect(files.get(`recettes-depenses-${month}.csv`)).toMatch(/;5161;Caisses;[^;]+;;0,00;450,00\r\nTotal;;;;;;0,00;450,00\r\n$/); // no batch: a general expense
});

// U16 (mockup F-Statements), T110 (FC8): a full-books entity's draft income statement and balance sheet, from its
// trial balance; the accountant reads them too.
test("a full-books entity sees its draft income statement and balance sheet", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const e164 = await ownerWithFarm(page, "Élevage du CPC");
  await scopeRemembered(page);
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);
  const box = crypto.randomUUID();
  const expense = (category: string, amountCentimes: string) => ({ type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(0), category, amountCentimes, paidFrom: "cash", treasuryId: box, note: null, batchId: null, serviceMonth: null } });
  const bank = crypto.randomUUID();
  await pushAs(page, [
    { type: "finance.createTreasuryAccount", payload: { id: box, kind: "cash", name: "Caisse" } },
    { type: "finance.createTreasuryAccount", payload: { id: bank, kind: "bank", name: "Banque" } },
    { type: "finance.recordTransfer", payload: { id: crypto.randomUUID(), day: farmDaysAgo(0), amountCentimes: "100000", fromId: bank, toId: box } }, // cash drawn from an overdrawn bank
    expense("water", "45000"),
    expense("vet_fees", "20000"),
  ]);
  await expect
    .poll(async () => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0].n)
    .toBe(4); // a transfer is two entries through 5115

  await page.goto("/fr/books");
  await page.getByRole("link", { name: "Produits et charges" }).click();
  const cpc = page.getByRole("table", { name: "Produits et charges" });
  await expect(cpc.getByRole("row").filter({ hasText: "Charges d’exploitation" })).toContainText(/650,00/);
  await expect(cpc.getByRole("row").filter({ hasText: /^612 / })).toContainText(/450,00/);
  await expect(cpc.getByRole("row").filter({ hasText: "Résultat net" })).toContainText(/-650,00/);

  // T110: cash 1 000 − 650 = 350 on the assets; the overdrawn bank (1 000) and the loss (−650) on the liabilities.
  const bilan = async (p: Page) => {
    await p.getByRole("link", { name: "Bilan (projet)" }).click();
    const sheet = p.getByRole("table", { name: "Bilan (projet)" });
    await expect(sheet.getByRole("caption")).toContainText("Projet");
    await expect(sheet.getByRole("row").filter({ hasText: /^Actif/ })).toContainText(/350,00/);
    await expect(sheet.getByRole("row").filter({ hasText: /^516 / })).toContainText(/350,00/);
    await expect(sheet.getByRole("row").filter({ hasText: /^Passif/ })).toContainText(/350,00/);
    await expect(sheet.getByRole("row").filter({ hasText: /^514 / })).toContainText(/1\s?000,00/);
    await expect(sheet.getByRole("row").filter({ hasText: "Résultat net" })).toContainText(/-650,00/);
  };
  await bilan(page);

  // The accountant (read-only, SPEC-m5 PA5) reads the same balance sheet.
  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("accountant");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  const accountantContext = await browser.newContext({ ...test.info().project.use });
  const accountant = await accountantContext.newPage();
  await login(accountant, "fr", phone);
  await expect(accountant).toHaveURL(/\/fr\/dashboard$/);
  await accountant.goto("/fr/books");
  await bilan(accountant);
  await accountantContext.close();
});
