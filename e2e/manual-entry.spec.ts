import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// T101 (SPEC-finance FCX3, FN3): the first year's opening balances, typed by the owner from the accountant's last
// balance sheet on the year's first day, with its receipt. The server rules are in src/modules/finance/manual.int.test.ts.
test("the owner types a three-line opening entry; it shows in the journal and the trial balance", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de l’Ouverture");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);
  const year = farmDaysAgo(0).slice(0, 4); // the fiscal year starts in January by default
  // FN3: the 5141 line names the bank account it opens.
  await scopeRemembered(page);
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: crypto.randomUUID(), kind: "bank", name: "Banque Populaire" } }]);

  await page.goto("/fr/books");
  await page.getByText("Écriture manuelle", { exact: true }).click();
  const form = page.locator("details");
  await form.getByLabel("Date").fill(`${year}-01-01`);
  await form.getByLabel("Libellé").fill("Soldes d’ouverture");
  await form.getByLabel("N° de pièce").fill("Bilan 2025");
  await form.getByRole("button", { name: "Ajouter une ligne" }).click();
  await form.getByLabel("Compte, ligne 1").fill("2340");
  await form.getByLabel("Débit, ligne 1").fill("80 000");
  await form.getByLabel("Compte, ligne 2").fill("5141");
  await form.getByLabel("Débit, ligne 2").fill("20000,00");
  await form.getByLabel("Compte bancaire ou caisse, ligne 2").selectOption({ label: "Banque Populaire" });
  const difference = form.getByText("Débit − crédit :");
  await expect(difference).toContainText(/100\s000,00/); // live, before the credit line
  await form.getByLabel("Compte, ligne 3").fill("1111");
  await form.getByLabel("Crédit, ligne 3").fill("100000");
  await expect(difference).toContainText(/\s0,00\sDH/);
  await expect(difference).toContainText("Écriture équilibrée"); // said in words, not by colour only
  await form.getByLabel("Justificatif (facultatif)").setInputFiles({ name: "bilan.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Passer l’écriture" }).click();
  await expect(form.getByText("Écriture enregistrée.")).toBeVisible();

  await form.getByRole("link", { name: "Voir le journal du mois" }).click();
  await expect(page).toHaveURL(new RegExp(`view=journals&month=${year}-01`));
  const entry = page.getByRole("table").filter({ hasText: "Soldes d’ouverture" });
  await expect(entry.getByRole("caption")).toContainText("Soldes d’ouverture · pièce Bilan 2025 · justificatif");
  await expect(entry.getByRole("row").filter({ hasText: /^2340 / })).toContainText(/80\s000,00/);
  await expect(entry.getByRole("row").filter({ hasText: /^5141 / })).toContainText(/20\s000,00/);
  await expect(entry.getByRole("row").filter({ hasText: /^1111 / })).toContainText(/100\s000,00/);
  const receipt = await page.request.get((await entry.getByRole("link", { name: "justificatif" }).getAttribute("href"))!);
  expect(Buffer.from(await receipt.body()).equals(PNG)).toBe(true);

  // The trial balance runs from the year's first day, so it holds the opening balances in every month of the year.
  await page.goto("/fr/books?view=trial");
  const trial = page.getByRole("table", { name: "Balance" });
  await expect(trial.getByRole("row").filter({ hasText: /^2340 / })).toContainText(/80\s000,00/);
  await expect(trial.getByRole("row").filter({ hasText: /^5141 / })).toContainText(/20\s000,00/);
  await expect(trial.getByRole("row").filter({ hasText: /^1111 / })).toContainText(/−100\s000,00/);
  await expect(trial.getByRole("row").last()).toContainText("Balance équilibrée");

  // FN10: the opening bank balance is the bank account's balance on /treasury.
  await page.goto("/fr/treasury");
  await expect(page.getByRole("list", { name: "Soldes" }).getByRole("listitem").filter({ hasText: "Banque Populaire" })).toContainText(/20[\s.]000,00\sDH/);
});
