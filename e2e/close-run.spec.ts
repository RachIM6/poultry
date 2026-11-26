import { expect, test } from "@playwright/test";
import { closeRun, ownerWithFarm, query } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T103 (SPEC-finance FCX4, FC1): the owner registers §7.1 A's generator, opens "Préparer la clôture" for 2026, reads
// the depreciation entry, posts it, and finds it in the journal on 31 December; a second run posts nothing. The
// versions, the locks, the count freeze and the roles in detail: src/modules/finance/close.int.test.ts.
test("the owner previews and posts the year's depreciation, finds it in the journal on 31 December, and a second run posts nothing", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Clôture annuelle");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);

  await page.goto("/fr/assets");
  await page.getByRole("button", { name: "Ajouter une immobilisation" }).click(); // a sheet (tasks/plan-ui-cleanup.md §2.7)
  const form = page.getByRole("dialog", { name: "Ajouter une immobilisation" });
  await form.getByLabel("Désignation").fill("Groupe électrogène");
  await form.getByLabel("Catégorie").selectOption("equipment");
  await form.getByLabel("Date d’acquisition").fill("2026-09-18");
  await form.getByLabel("Date de mise en service").fill("2026-09-18");
  await form.getByLabel("Coût d’acquisition (montant de la facture, TVA comprise)").fill("47 350");
  await form.getByLabel("Durée d’utilisation, en mois").fill("84");
  await form.getByLabel("Paiement").selectOption("cash");
  await form.getByRole("button", { name: "Enregistrer l’immobilisation" }).click();
  await expect(form).toBeHidden(); // saved, the sheet closes on the register
  await expect(page.getByRole("region", { name: "Groupe électrogène" })).toBeVisible();

  // FCX2: "Plus" › Argent, next to the count sheet.
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Clôture de l’exercice" }).click(); // step 1, the count (tasks/plan-ui-cleanup.md §3)
  await page.getByRole("navigation", { name: "Clôture de l’exercice" }).getByRole("link", { name: "2 Écritures de clôture" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Préparer la clôture");
  await page.goto("/fr/closing?year=2026");
  await expect(page.getByText(/^Les écritures de fin d’exercice, en opérations diverses \(OD\) au 31 décembre 2026/)).toBeVisible();

  // §7.1 A, 2026: 4 months of 84, D 61933 / C 28332 2 254,76.
  const depreciation = page.getByRole("region", { name: "Dotations aux amortissements" });
  await expect(depreciation).toContainText("À comptabiliser.");
  const rows = depreciation.getByRole("table", { name: "Écriture · Dotations aux amortissements" }).getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText(/^61933 D\.E\.A\. des installations techniques, matériel et outillage\s*2\s254,76/);
  await expect(rows.nth(2)).toContainText(/^28332 Amortissements du matériel et outillage\s*2\s254,76/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // fits the phone

  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 1.")).toBeVisible(closeRun);
  await expect(depreciation).toContainText("Comptabilisée, sans changement.");
  await expect(page.getByText("Rien à comptabiliser.", { exact: true })).toBeVisible();

  // OD on the fiscal year's last day.
  await page.goto("/fr/books?view=journals&month=2026-12");
  const entry = page.getByRole("table").filter({ hasText: "31 décembre 2026 · Dotations aux amortissements de l’exercice" });
  await expect(entry.getByRole("row").filter({ hasText: /^61933 / })).toContainText(/2\s254,76/);
  await expect(entry.getByRole("row").filter({ hasText: /^28332 / })).toContainText(/2\s254,76/);

  // Running it again with the same facts posts nothing.
  await page.goto("/fr/closing?year=2026");
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Rien à comptabiliser : aucune écriture passée.")).toBeVisible(closeRun);
  await page.goto("/fr/books?view=journals&month=2026-12");
  await expect(page.getByRole("table").filter({ hasText: "Dotations aux amortissements de l’exercice" })).toHaveCount(1);

  // The accountant reads the preview without the button (FCX1); a worker gets nothing (FX2).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/closing?year=2026");
  await expect(page.getByRole("region", { name: "Dotations aux amortissements" })).toContainText("Comptabilisée, sans changement.");
  await expect(page.getByRole("button", { name: "Comptabiliser les écritures de clôture" })).toHaveCount(0);
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Dotations aux amortissements" })).toHaveCount(0);
  await expect(page.getByText("La clôture est réservée au propriétaire, au gérant et au comptable.")).toBeVisible();
});
