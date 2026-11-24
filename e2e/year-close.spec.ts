import { expect, test } from "@playwright/test";
import { closeRun, ownerWithFarm, query } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T104 (SPEC-finance FCX5, FCX6): the owner registers §7.1 A's generator in 2025, is told to run the close first,
// runs it, closes 2025, reads "Exercice clôturé le …" on /closing and on the bilan, and finds the 2026 à-nouveaux in
// the journal on 1 January. The versions, the reversals, the refusals and the roles in detail:
// src/modules/finance/year-close.int.test.ts and year-close-reversal.int.test.ts.
test("the owner runs the close, closes the year, reads « Exercice clôturé le … », and finds the next year's à-nouveaux in the books", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de l’Exercice clos");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);

  await page.goto("/fr/assets");
  await page.getByText("Ajouter une immobilisation", { exact: true }).click();
  const form = page.locator("details").first();
  await form.getByLabel("Désignation").fill("Groupe électrogène");
  await form.getByLabel("Catégorie").selectOption("equipment");
  await form.getByLabel("Date d’acquisition").fill("2025-09-18");
  await form.getByLabel("Date de mise en service").fill("2025-09-18");
  await form.getByLabel("Coût d’acquisition (montant de la facture, TVA comprise)").fill("47 350");
  await form.getByLabel("Durée d’utilisation, en mois").fill("84");
  await form.getByLabel("Paiement").selectOption("cash");
  await form.getByRole("button", { name: "Enregistrer l’immobilisation" }).click();
  await expect(form.getByText("Immobilisation enregistrée.")).toBeVisible();

  // The close run first: the year close refuses while the preview still has an entry to post.
  await page.goto("/fr/closing?year=2025");
  await page.getByRole("button", { name: "Clôturer l’exercice" }).click();
  await expect(page.getByText("Comptabilisez d’abord les écritures de clôture : l’aperçu en montre encore à passer.")).toBeVisible(closeRun);
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 1.")).toBeVisible(closeRun);

  await page.getByRole("button", { name: "Clôturer l’exercice" }).click();
  await expect(page.getByText("Exercice clôturé. Écritures d’ouverture passées : 1.")).toBeVisible(closeRun);
  await expect(page.getByText(/^Exercice clôturé le \d{1,2} \S+ \d{4}\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Comptabiliser les écritures de clôture" })).toBeDisabled(); // every month locked
  await expect(page.getByRole("button", { name: "Rouvrir l’exercice" })).toBeVisible();

  // The statements say so instead of "Projet".
  await page.goto("/fr/books?view=bilan&month=2025-12");
  const sheet = page.getByRole("table", { name: "Bilan", exact: true });
  await expect(sheet.getByRole("caption")).toContainText(/^Exercice clôturé le \d{1,2} \S+ \d{4}, depuis son début/);
  await expect(page.getByRole("link", { name: "Bilan (projet)" })).toHaveCount(0);

  // The 2026 à-nouveaux: OD on 1 January, classes 1–5 carried forward and the 2025 loss (the depreciation) on 1199.
  await page.goto("/fr/books?view=journals&month=2026-01");
  const opening = page.getByRole("table").filter({ hasText: "1 janvier 2026 · À-nouveaux" });
  await expect(opening.getByRole("row").filter({ hasText: /^23321 / })).toContainText(/47\s350,00/);
  await expect(opening.getByRole("row").filter({ hasText: /^28332 / })).toContainText(/2\s254,76/);
  await expect(opening.getByRole("row").filter({ hasText: /^5161 / })).toContainText(/47\s350,00/);
  await expect(opening.getByRole("row").filter({ hasText: /^1199 / })).toContainText(/2\s254,76/);

  // The accountant sees the status, without the buttons (FCX1).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/closing?year=2025");
  await expect(page.getByText(/^Exercice clôturé le \d{1,2} \S+ \d{4}\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Rouvrir l’exercice" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clôturer l’exercice" })).toHaveCount(0);
});
