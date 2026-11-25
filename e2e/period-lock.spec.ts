import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, query } from "./auth";

// SPEC-finance FN5, FCX3 (2026-11-23): on /books, the owner cancels a mistyped manual entry, then locks the month
// after sending the export and unlocks it. The server rules are in src/modules/finance/period-lock.int.test.ts.
test("the owner cancels a manual entry, then locks and unlocks the month", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Période");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);
  const today = farmDaysAgo(0);
  const month = today.slice(0, 7);

  await page.goto(`/fr/books?view=journals&month=${month}`);
  await page.getByText("Écriture manuelle", { exact: true }).click();
  const form = page.locator("details");
  await form.getByLabel("Libellé").fill("Intérêts mal saisis");
  await form.getByLabel("Compte, ligne 1").fill("63111");
  await form.getByLabel("Débit, ligne 1").fill("120");
  await form.getByLabel("Compte, ligne 2").fill("4493");
  await form.getByLabel("Crédit, ligne 2").fill("120");
  await form.getByRole("button", { name: "Passer l’écriture" }).click();
  await expect(form.getByText("Écriture enregistrée.")).toBeVisible();

  // FN5: a reversal on the same day, after a confirmation; the entry stays, marked as cancelled, with no button.
  const cancel = page.getByRole("button", { name: /^Annuler l’écriture .*Intérêts mal saisis/ });
  page.once("dialog", (d) => void d.accept());
  await cancel.click();
  await expect(page.getByText(/^Écriture annulée\./)).toBeVisible();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole("table").filter({ hasText: "Intérêts mal saisis · annulée" })).toBeVisible();
  const reversal = page.getByRole("table").filter({ hasText: "Annulation : Intérêts mal saisis" });
  await expect(reversal.getByRole("row").filter({ hasText: /^4493 / })).toContainText(/120,00/);

  // The month locked: the form refuses an entry dated in it; unlocked: it is open again.
  const period = page.getByRole("region", { name: "Période" });
  await expect(period).toContainText("Ce mois est ouvert");
  await period.getByRole("button", { name: "Clôturer le mois" }).click();
  await expect(period).toContainText("Ce mois est clôturé");
  const monthName = new Intl.DateTimeFormat("fr", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  await expect(period.getByRole("link", { name: monthName })).toBeVisible(); // "novembre 2026", not "2026-11"
  await form.getByLabel("Libellé").fill("Trop tard");
  await form.getByLabel("Compte, ligne 1").fill("63111");
  await form.getByLabel("Débit, ligne 1").fill("10");
  await form.getByLabel("Compte, ligne 2").fill("4493");
  await form.getByLabel("Crédit, ligne 2").fill("10");
  await form.getByRole("button", { name: "Passer l’écriture" }).click();
  await expect(form.getByRole("alert")).toHaveText("Cette période est clôturée : aucune écriture ne peut y être ajoutée.");
  await period.getByRole("button", { name: "Rouvrir le mois" }).click();
  await expect(period).toContainText("Ce mois est ouvert");
});
