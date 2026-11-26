import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const entityOf = async (e164: string) =>
  (
    await query<{ books: string | null; pca: boolean | null; month: number; vat: boolean; key: string }>(
      `SELECT l.books::text, l."pcaOverlay" AS pca, l."fiscalYearStartMonth" AS month, l."vatRegistered" AS vat, l."allocationKey"::text AS key FROM "LegalEntity" l
       JOIN "Membership" m ON m."organizationId" = l."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    )
  )[0];

// U14 (SPEC-finance FN1, FN9, FN14, mockup F-Profile): the owner sets the books, the chart, the fiscal year, VAT and
// the shared costs' key, until the year's first entry locks them.
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
  await page.getByLabel(/Surface du bâtiment/).check();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Paramètres enregistrés.");
  expect(await entityOf(e164)).toEqual({ books: "ledger", pca: false, month: 7, vat: true, key: "houseArea" });

  // A purchase posts an entry this fiscal year: the choices are locked until the next one.
  const [farm, item, supplier] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "inventory.createSupplier", payload: { id: supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: item, farmId: farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: supplier, stockItemId: item, day: new Date().toISOString().slice(0, 10), quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
  ]);
  await expect
    .poll(async () => (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0].n)
    .toBe(1);
  await page.reload();
  await expect(page.getByRole("note")).toContainText("L’exercice a déjà des écritures");
  await expect(page.getByRole("button", { name: "Enregistrer", exact: true })).toHaveCount(0); // locked: no save, the note says why
  await expect(page.getByLabel(/Plan comptable général des entreprises/)).toBeDisabled();

  await page.goto("/ar/settings/accounting");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإعدادات المحاسبية");
  await expect(page.getByLabel("خاضع للضريبة على القيمة المضافة")).toBeChecked();
  await expect(page.getByLabel(/مساحة المبنى/)).toBeChecked();
});

// F-Profile: the owner types the entity's ICE, IF, RC and CNSS numbers; they head the official statements, which the
// accountant reads too. The ICE is 15 digits, checked by the form and by the server (farm-registry/legal-ids.int.test.ts).
test("the owner records the registration numbers and they head the statements", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Numéros");
  await scopeRemembered(page);
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);

  await page.goto("/fr/settings/accounting");
  const form = page.getByRole("form", { name: "Identité de l’entreprise" });
  const ice = form.getByLabel(/^ICE/);
  await ice.fill("12345");
  await form.getByRole("button", { name: "Enregistrer l’identité" }).click();
  expect(await ice.evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true); // not sent
  await ice.fill("001534290 0000 57");
  await form.getByLabel("Identifiant fiscal (IF)").fill("12345678");
  await form.getByLabel(/numéro$/).fill("98765");
  await form.getByLabel(/^Tribunal/).fill("Casablanca");
  await form.getByLabel(/CNSS/).fill("1234567");
  await form.getByRole("button", { name: "Enregistrer l’identité" }).click();
  await expect(form.getByRole("status")).toHaveText("Identité enregistrée.");
  await page.reload();
  await expect(page.getByRole("form", { name: "Identité de l’entreprise" }).getByLabel(/^ICE/)).toHaveValue("001534290000057");

  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = (SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`, [e164]);
  await page.goto("/fr/closing/statements");
  const ids = page.getByRole("definition");
  await expect(page.getByText("Élevage des Numéros · Exploitant individuel")).toBeVisible();
  await expect(ids).toHaveText(["001534290000057", "12345678", "98765 · Casablanca", "1234567"]);

  // The accountant opens the settings from /more and reads the profile and the numbers: no form, nothing to edit.
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Paramètres comptables" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paramètres comptables");
  const main = page.getByRole("main");
  await expect(main.getByRole("definition")).toContainText(["001534290000057", "12345678", "98765 · Casablanca", "1234567", "Comptabilité en partie double"]);
  await expect(main.locator("form")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
});

// U15 (mockup F-Chart, SPEC-finance FN2, FN6): what each operation is posted to, in both charts, grouped by account
// class (tasks/plan-ui-cleanup.md §4), the « Plan de comptes » tab of « Paramètres comptables ».
test("the chart screen shows where each operation is posted", async ({ page }) => {
  await ownerWithFarm(page, "Élevage du Plan");
  await scopeRemembered(page);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Plan de comptes" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paramètres comptables");
  const tabs = page.getByRole("navigation", { name: "Paramètres comptables" });
  await expect(tabs.getByRole("link", { name: "Plan de comptes" })).toHaveAttribute("aria-current", "page");
  const chart = page.getByRole("table", { name: "Plan de comptes" });
  await expect(chart.getByRole("columnheader", { name: "Charges (classe 6)" })).toBeAttached();
  const feed = chart.getByRole("row").filter({ hasText: "Achat d’aliment" });
  await expect(feed).toContainText("612122");
  await expect(feed).toContainText("6121");
  await expect(page.getByText("Votre entité utilise le plan comptable agricole (en gras).")).toBeVisible();

  // the owner's tabs: the profile, the chart and the replaced accounts (/settings/posting, in no menu before)
  await tabs.getByRole("link", { name: "Comptes remplacés" }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/posting$/);
  await expect(tabs.getByRole("link", { name: "Comptes remplacés" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Profil" }).click();
  await expect(page).toHaveURL(/\/fr\/settings\/accounting$/);
  await expect(page.getByRole("link", { name: "Remplacer un compte" })).toHaveCount(0); // the old links card is gone

  await page.goto("/ar/settings/chart");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الإعدادات المحاسبية");
  await expect(page.getByRole("row").filter({ hasText: "شراء الأعلاف" })).toContainText("612122");
});

// FN8: the owner replaces a rule's account in a sheet, then goes back to the default (tasks/plan-ui-cleanup.md §4).
test("the owner replaces an account in a sheet and goes back to the default", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage des Comptes Remplacés");
  await scopeRemembered(page);
  await page.goto("/fr/settings/posting");
  const water = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^Eau/ }) });
  const open = water.getByRole("button", { name: "Remplacer : Eau" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Remplacer : Eau" });
  const account = sheet.getByLabel("Nouveau compte");
  await expect(account).toBeFocused();
  await page.keyboard.press("Escape"); // closes, the focus back on the row's button
  await expect(sheet).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  // another leaf of class 6 than the default, so going back shows it gone
  const byDefault = (await sheet.locator("bdi").first().textContent())!;
  const choice = (await account.locator("option").filter({ hasNotText: byDefault }).first().textContent())!;
  await account.selectOption({ label: choice });
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Compte enregistré pour les nouvelles écritures.");
  await expect(sheet).toBeHidden();
  await expect(water).toContainText(choice);

  await open.click();
  await sheet.getByRole("button", { name: "Revenir au compte par défaut : Eau" }).click();
  await expect(sheet).toBeHidden();
  await expect(water).not.toContainText(choice);
});
