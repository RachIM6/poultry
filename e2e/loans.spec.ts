import { expect, test } from "@playwright/test";
import { ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T105 (SPEC-finance FC2): an individual farmer (cash_book) types §7.1 B's loan on "Emprunts et subventions", adjusts
// and confirms its schedule, marks the first installment paid, and finds it in the receipts-and-expenses book. The
// postings, roles, reminders and the cash schedule in detail: src/modules/finance/loans.int.test.ts; the schedule:
// finance/domain/loans.test.ts.
test("the owner creates a loan, confirms its schedule, marks the first installment paid; it shows in the cash book", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Emprunts");
  await scopeRemembered(page);
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: crypto.randomUUID(), kind: "bank", name: "Banque Populaire" } }]);

  await page.goto("/fr/dashboard");
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // FCX2: "Plus" › Argent
  await page.getByRole("link", { name: "Emprunts et subventions" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Emprunts et subventions");
  await expect(page.getByText("Aucun emprunt.")).toBeVisible();

  // §7.1 B, a year earlier: 100 000,00 at 5,55 % over 6 quarters, from 31 March.
  await page.getByText("Ajouter un emprunt", { exact: true }).click();
  const form = page.locator("details").first();
  await form.getByLabel("Prêteur").fill("Crédit Agricole du Maroc");
  await form.getByLabel("Compte bancaire du déblocage et des échéances").selectOption({ label: "Banque Populaire" });
  await form.getByLabel("Capital emprunté").fill("100 000");
  await form.getByLabel("Taux annuel du contrat, en %").fill("5,55");
  await form.getByLabel("Périodicité").selectOption("quarterly");
  await form.getByLabel("Nombre d’échéances de capital").fill("6");
  await form.getByLabel("Date de déblocage").fill("2026-01-15");
  await form.getByLabel("Date de la première échéance").fill("2026-03-31");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // the form fits the phone
  await form.getByRole("button", { name: "Calculer l’échéancier" }).click();
  await expect(form.getByText(/^Échéancier calculé/)).toBeVisible();

  const loan = page.getByRole("region", { name: "Crédit Agricole du Maroc" });
  const schedule = loan.getByRole("table", { name: "Échéancier · Crédit Agricole du Maroc" });
  await expect(schedule.getByRole("row")).toHaveCount(8); // header, 6 rows, totals
  await expect(loan.getByLabel("Intérêts de l’échéance 1")).toHaveValue("1387,50");
  await expect(loan.getByLabel("Capital de l’échéance 6")).toHaveValue("16666,65");
  await expect(schedule.getByRole("row").nth(6)).toContainText("30 juin 2027");
  await expect(schedule.getByRole("row").last()).toContainText(/Total\s*4\s856,25\sDH\s*100\s000,00\sDH\s*104\s856,25\sDH/);

  // The capital must add up to the principal before the schedule is confirmed.
  await loan.getByLabel("Capital de l’échéance 1").fill("16666,68");
  await loan.getByRole("button", { name: "Confirmer l’échéancier" }).click();
  await expect(loan.getByRole("alert")).toHaveText(/^Le capital des échéances ne totalise pas le capital emprunté/);
  await loan.getByLabel("Capital de l’échéance 1").fill("16666,67");
  await loan.getByRole("button", { name: "Confirmer l’échéancier" }).click();
  await expect(loan.getByText(/^Capital restant dû :/)).toContainText(/100\s000,00\sDH/);
  await expect(loan.getByLabel("Capital de l’échéance 1")).toHaveCount(0); // fixed

  // Installment 1, debited on its due day (the default).
  const first = schedule.getByRole("row").nth(1);
  await expect(first.getByLabel("Date de débit de l’échéance 1")).toHaveValue("2026-03-31");
  await first.getByRole("button", { name: "Marquer payée" }).click();
  await expect(first).toContainText("Payée le 31 mars 2026");
  await expect(loan.getByText(/^Capital restant dû :/)).toContainText(/83\s333,33\sDH/);

  // FN16: the disbursement in January, the installment in March, on the bank account.
  await page.goto("/fr/books?month=2026-01");
  const book = page.getByRole("table", { name: "Recettes et dépenses" });
  await expect(book.getByRole("row").filter({ hasText: "Déblocage d’emprunt : Crédit Agricole du Maroc" })).toContainText(/5141.*100\s000,00\sDH/);
  await page.goto("/fr/books?month=2026-03");
  const installment = book.getByRole("row").filter({ hasText: "Échéance d’emprunt n° 1 : Crédit Agricole du Maroc" });
  await expect(installment).toContainText(/Emprunts auprès des établissements de crédit, Intérêts des emprunts(?! et dettes)/); // 63111's label
  await expect(installment).toContainText(/5141.*18\s054,17\sDH/);

  // The accountant reads the schedule without its forms; a worker gets nothing (FX2).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/loans");
  await expect(schedule.getByRole("row").nth(1)).toContainText("Payée le 31 mars 2026");
  await expect(page.getByRole("button", { name: "Marquer payée" })).toHaveCount(0);
  await expect(page.getByText("Ajouter un emprunt", { exact: true })).toHaveCount(0);
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Crédit Agricole du Maroc" })).toHaveCount(0);
  await expect(page.getByText("Les dépenses et la trésorerie sont réservées au propriétaire et au gérant.")).toBeVisible();
});
