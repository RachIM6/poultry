import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

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
  await page.getByRole("link", { name: "Rapprochement bancaire" }).click();
  await expect(page.getByText("Aucun relevé pour ce compte.")).toBeVisible();

  // The statement as printed: the deposit and the electricity bill are on it, the water bill isn't yet.
  await page.getByLabel("Date de fin du relevé").fill(farmDaysAgo(0));
  await page.getByLabel("Solde final du relevé (DH)").fill("8 800,00");
  await page.getByRole("button", { name: "Enregistrer le relevé" }).click();
  const status = page.getByRole("status").filter({ hasText: /rapproché/i });
  await expect(status).toHaveText("Non rapproché");
  const figures = page.getByRole("definition");
  await expect(figures.nth(1)).toHaveText(/8.500,00\sDH/); // book balance: 10 000 − 1 200 − 300
  await expect(figures.nth(3)).toHaveText(/8.800,00\sDH/); // nothing ticked yet

  const row = (text: string | RegExp) => page.getByRole("row").filter({ hasText: text });
  const [deposit, power, water] = [row("Virement de fonds"), row(/1.200,00/), row(/300,00/)];
  for (const line of [deposit, power]) {
    await line.getByRole("button", { name: "Pointer" }).click();
    await expect(line.getByRole("button", { name: "Dépointer" })).toBeVisible();
  }
  await expect(status).toHaveText("Rapproché");
  await expect(figures.nth(3)).toHaveText(/^0,00\sDH$/);
  await expect(water.getByRole("button", { name: "Pointer" })).toBeVisible(); // not at the bank yet

  // A tick is undone until its month is locked.
  await deposit.getByRole("button", { name: "Dépointer" }).click();
  await expect(status).toHaveText("Non rapproché");
});
