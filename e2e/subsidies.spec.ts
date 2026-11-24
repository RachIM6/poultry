import { expect, test } from "@playwright/test";
import { closeRun, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T106 (SPEC-finance FC2, FQ17): the owner registers §7.1 A's generator, records the 14 205,00 subsidy that finances
// it on "Emprunts et subventions", reads its release by year, then finds the 2026 release on 7577 in the close run's
// preview and posts it. The refusals, the roles, the reruns and the cash book in detail:
// src/modules/finance/subsidies.int.test.ts; the release: finance/domain/subsidies.test.ts.
test("the owner records a subsidy with the asset it finances, reads its release by year, and posts the year's release on 7577", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Subventions");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await scopeRemembered(page);
  await pushAs(page, [{ type: "finance.createTreasuryAccount", payload: { id: crypto.randomUUID(), kind: "bank", name: "Banque Populaire" } }]);

  await page.goto("/fr/assets");
  await page.getByText("Ajouter une immobilisation", { exact: true }).click();
  const asset = page.locator("details").first();
  await asset.getByLabel("Désignation").fill("Groupe électrogène");
  await asset.getByLabel("Catégorie").selectOption("equipment");
  await asset.getByLabel("Date d’acquisition").fill("2026-09-18");
  await asset.getByLabel("Date de mise en service").fill("2026-09-18");
  await asset.getByLabel("Coût d’acquisition (montant de la facture, TVA comprise)").fill("47 350");
  await asset.getByLabel("Durée d’utilisation, en mois").fill("84");
  await asset.getByLabel("Paiement").selectOption("cash");
  await asset.getByRole("button", { name: "Enregistrer l’immobilisation" }).click();
  await expect(asset.getByText("Immobilisation enregistrée.")).toBeVisible();

  await page.goto("/fr/loans");
  await expect(page.getByText("Aucune subvention.")).toBeVisible();
  await page.getByText("Ajouter une subvention", { exact: true }).click();
  const form = page.locator("details").filter({ hasText: "Ajouter une subvention" });
  await form.getByLabel("Objet de la subvention").fill("Aide à l’équipement");
  await form.getByLabel("Organisme qui l’accorde").fill("Fonds de développement agricole");
  await form.getByLabel("Montant reçu").fill("14 205");
  await form.getByLabel("Date de réception").fill("2026-10-05");
  await form.getByLabel("Compte bancaire de réception").selectOption({ label: "Banque Populaire" });
  await form.getByRole("group", { name: "Immobilisations financées" }).getByLabel("Groupe électrogène").check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // the form fits the phone
  await form.getByRole("button", { name: "Enregistrer la subvention" }).click();
  await expect(form.getByText("Subvention enregistrée.")).toBeVisible();

  // §7.1 A: 676,43 in 2026, 2 029,29 in 2027, 14 205,00 released by the end of the generator's life (2033).
  const subsidy = page.getByRole("region", { name: "Aide à l’équipement" });
  await expect(subsidy).toContainText(/Fonds de développement agricole · 14\s205,00\sDH · reçue le 5 octobre 2026 · Banque Populaire/);
  await expect(subsidy).toContainText("Immobilisations financées : Groupe électrogène");
  const years = subsidy.getByRole("table", { name: "Reprise par exercice · Aide à l’équipement" }).getByRole("row");
  await expect(years).toHaveCount(9); // header, 2026 to 2033
  await expect(years.nth(1)).toContainText(/^2026\s*676,43\sDH\s*676,43\sDH\s*13\s528,57\sDH$/);
  await expect(years.nth(2)).toContainText(/^2027\s*2\s029,29\sDH\s*2\s705,72\sDH/);
  await expect(years.last()).toContainText(/^2033.*14\s205,00\sDH\s*0,00\sDH$/);

  // The close run's preview: the subsidy release, D 1319 / C 7577 676,43, next to the depreciation.
  await page.goto("/fr/closing?year=2026");
  const release = page.getByRole("region", { name: "Quote-part des subventions d’investissement" });
  await expect(release).toContainText("À comptabiliser.");
  const rows = release.getByRole("table", { name: "Écriture · Quote-part des subventions d’investissement" }).getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText(/^1319 Subventions d’investissement inscrites au compte de produits et charges\s*676,43/);
  await expect(rows.nth(2)).toContainText(/^7577 Reprises sur subventions d’investissement de l’exercice\s*676,43/);
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 2.")).toBeVisible(closeRun);
  await expect(release).toContainText("Comptabilisée, sans changement.");

  await page.goto("/fr/books?view=journals&month=2026-12");
  const entry = page.getByRole("table").filter({ hasText: "31 décembre 2026 · Quote-part des subventions d’investissement virée au résultat" });
  await expect(entry.getByRole("row").filter({ hasText: /^7577 / })).toContainText(/676,43/);

  // The accountant reads the subsidy without the form (FCX1); a worker gets nothing (FX2).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/loans");
  await expect(years.nth(1)).toContainText("676,43");
  await expect(page.getByText("Ajouter une subvention", { exact: true })).toHaveCount(0);
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Aide à l’équipement" })).toHaveCount(0);
  await expect(page.getByText("Les dépenses et la trésorerie sont réservées au propriétaire et au gérant.")).toBeVisible();
});
