import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// tasks/plan-ui-cleanup.md batch 4: « États de synthèse » is the closing's step 3, its parts as tabs on screen, every part
// on paper. The figures themselves: src/modules/finance/statements.int.test.ts.
test("the statements show one part per tab, keep the year across the closing's steps, and print every part", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des États");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await scopeRemembered(page);
  const box = crypto.randomUUID();
  await pushAs(page, [
    { type: "finance.createTreasuryAccount", payload: { id: box, kind: "cash", name: "Caisse" } },
    { type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(0), category: "water", amountCentimes: "45000", paidFrom: "cash", treasuryId: box, note: null, batchId: null, serviceMonth: null } },
  ]);
  const year = farmDaysAgo(0).slice(0, 4);

  await page.goto(`/fr/closing/statements?year=${year}`);
  const steps = page.getByRole("navigation", { name: "Clôture de l’exercice" });
  await expect(steps.getByRole("link", { name: "3 États de synthèse" })).toHaveAttribute("aria-current", "page");
  await expect(steps.getByRole("link", { name: "1 Inventaire" })).toHaveAttribute("href", `/fr/closing/count?year=${year}`);
  await expect(steps.getByRole("link", { name: "2 Écritures de clôture" })).toHaveAttribute("href", `/fr/closing?year=${year}`);

  // One part at a time on screen, the first by default.
  const parts = page.getByRole("navigation", { name: "Parties des états" });
  const actif = page.getByRole("table", { name: "Actif", exact: true });
  const passif = page.getByRole("table", { name: "Passif", exact: true });
  const cpc = page.getByRole("heading", { name: "Compte de produits et charges (hors taxes)" });
  const etic = page.getByRole("heading", { name: "État des informations complémentaires" });
  await expect(parts.getByRole("link", { name: "Bilan actif" })).toHaveAttribute("aria-current", "page");
  await expect(actif).toBeVisible();
  for (const hidden of [passif, cpc, etic]) await expect(hidden).toBeHidden();
  await parts.getByRole("link", { name: "Produits et charges" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/closing/statements\\?year=${year}&tab=cpc$`));
  await expect(cpc).toBeVisible();
  await expect(actif).toBeHidden();
  await expect(page.getByText("PROJET", { exact: true })).toBeVisible(); // the draft's watermark on every part

  // Lines with nothing in them wait behind « Afficher les lignes vides » on screen.
  await parts.getByRole("link", { name: "Bilan actif" }).click();
  await expect(actif).toBeVisible();
  const shown = await actif.getByRole("row").count();
  await page.getByRole("link", { name: "Afficher les lignes vides" }).click();
  await expect(page).toHaveURL(/empty=1/);
  await expect.poll(() => actif.getByRole("row").count()).toBeGreaterThan(shown);
  await page.getByRole("link", { name: "Masquer les lignes vides" }).click();
  await expect.poll(() => actif.getByRole("row").count()).toBe(shown);

  // Paper: every part and every line, the watermark, no tabs, on A4.
  await page.emulateMedia({ media: "print" });
  for (const part of [actif, passif, cpc, etic]) await expect(part).toBeVisible();
  await expect.poll(() => actif.getByRole("row").count()).toBeGreaterThan(shown);
  await expect(page.getByText("PROJET", { exact: true })).toBeVisible();
  await expect(parts).toBeHidden();
  await expect(steps).toBeHidden();
  await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath("statements-fr.pdf") });
  await page.emulateMedia({ media: "screen" });

  // The step tabs carry the year.
  await steps.getByRole("link", { name: "1 Inventaire" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/closing/count\\?year=${year}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inventaire de fin d’exercice");
  await page.getByRole("navigation", { name: "Clôture de l’exercice" }).getByRole("link", { name: "2 Écritures de clôture" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/closing\\?year=${year}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Préparer la clôture");

  // An individual farmer's books have no statements: a plain note says why, the steps stay.
  await query(`UPDATE "LegalEntity" SET books = 'cash_book' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto(`/fr/closing?year=${year}`);
  await expect(page.getByText(/^Livre des recettes et dépenses : pas de bilan, donc pas d’écritures de clôture/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Comptabiliser les écritures de clôture" })).toHaveCount(0);
  await page.goto(`/fr/closing/statements?year=${year}`);
  await expect(page.getByText(/^Livre des recettes et dépenses : pas de bilan ni de compte de produits et charges/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Clôture de l’exercice" })).toBeVisible();
});
