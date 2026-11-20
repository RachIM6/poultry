import { expect, test } from "@playwright/test";
import { ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const entityOf = async (e164: string) =>
  (
    await query<{ books: string | null; pca: boolean | null; month: number; vat: boolean }>(
      `SELECT l.books::text, l."pcaOverlay" AS pca, l."fiscalYearStartMonth" AS month, l."vatRegistered" AS vat FROM "LegalEntity" l
       JOIN "Membership" m ON m."organizationId" = l."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    )
  )[0];

// U14 (SPEC-finance FN1, FN9, mockup F-Profile): the owner sets the books, the chart, the fiscal year and VAT, until
// the year's first entry locks them.
test("the owner changes the accounting choices until the year has an entry", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Comptes");
  await scopeRemembered(page);

  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Paramètres comptables" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paramètres comptables");
  await page.getByLabel(/Comptabilité en partie double/).check();
  await page.getByLabel(/Plan comptable général des entreprises/).check();
  await page.getByLabel("Début d’exercice").selectOption({ label: "juillet" });
  await page.getByLabel("Assujetti à la TVA").check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toHaveText("Paramètres enregistrés.");
  expect(await entityOf(e164)).toEqual({ books: "ledger", pca: false, month: 7, vat: true });

  // A purchase posts an entry this fiscal year: the choices are locked until the next one.
  const [farm, item, supplier] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "inventory.createSupplier", payload: { id: supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: item, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: supplier, stockItemId: item, day: new Date().toISOString().slice(0, 10), quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
  ]);
  await expect
    .poll(async () => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0].n)
    .toBe(1);
  await page.reload();
  await expect(page.getByRole("note")).toContainText("L’exercice a déjà des écritures");
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

  await page.goto("/ar/settings/accounting");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإعدادات المحاسبية");
  await expect(page.getByLabel("خاضع للضريبة على القيمة المضافة")).toBeChecked();
});
