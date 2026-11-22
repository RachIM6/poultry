import { expect, test } from "@playwright/test";
import { ownerWithFarm, query } from "./auth";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T102 (SPEC-finance FC1): the owner registers §7.1 A's generator on "Immobilisations", reads its schedule by year,
// finds the acquisition in the journal, then disposes of it. The postings, roles and isolation in detail:
// src/modules/finance/assets.int.test.ts; the schedule: finance/domain/assets.test.ts.
test("the owner registers an asset, reads its schedule by year and disposes of it; the accountant reads, a worker can't", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Immobilisations");
  await page.goto("/fr/dashboard");
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // FCX2: "Plus" › Argent
  await page.getByRole("link", { name: "Immobilisations" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Immobilisations");
  await expect(page.getByText("Aucune immobilisation.")).toBeVisible();

  // An individual farmer keeps the receipts-and-expenses book: the register and schedules only (FCX4, FQ27).
  await expect(page.getByText(/^Livre des recettes et dépenses : le registre et les plans d’amortissement seulement/)).toBeVisible();

  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByText(/^Livre des recettes et dépenses : le registre/)).toHaveCount(0);
  await page.getByText("Ajouter une immobilisation", { exact: true }).click();
  const form = page.locator("details").first();
  await form.getByLabel("Désignation").fill("Groupe électrogène");
  await form.getByLabel("Catégorie").selectOption("land");
  await expect(form.getByLabel("Durée d’utilisation, en mois")).toHaveCount(0); // land: no life
  await form.getByLabel("Catégorie").selectOption("equipment");
  await expect(form.getByLabel("Durée d’utilisation, en mois")).toHaveValue(""); // never prefilled
  await form.getByLabel("Date d’acquisition").fill("2026-09-18");
  await form.getByLabel("Date de mise en service").fill("2026-09-18");
  await form.getByLabel("Coût d’acquisition (montant de la facture, TVA comprise)").fill("47 350");
  await form.getByLabel("Durée d’utilisation, en mois").fill("84");
  await form.getByLabel("Paiement").selectOption("cash");
  await form.getByLabel("Facture (facultatif)").setInputFiles({ name: "facture.png", mimeType: "image/png", buffer: PNG });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // the form fits the phone
  await form.getByRole("button", { name: "Enregistrer l’immobilisation" }).click();
  await expect(form.getByText("Immobilisation enregistrée.")).toBeVisible();

  // §7.1 A, by fiscal year (January–December by default).
  const asset = page.getByRole("region", { name: "Groupe électrogène" });
  await expect(asset).toContainText(/Coût\s*47\s350,00\sDH/);
  const schedule = asset.getByRole("table", { name: "Plan d’amortissement · Groupe électrogène" }).getByRole("row");
  await expect(schedule).toHaveCount(9);
  await expect(schedule.nth(1)).toContainText(/2026\s*4\s*2\s254,76\sDH\s*2\s254,76\sDH\s*45\s095,24\sDH/);
  await expect(schedule.nth(2)).toContainText(/2027\s*12\s*6\s764,29\sDH\s*9\s019,05\sDH\s*38\s330,95\sDH/);
  await expect(schedule.nth(3)).toContainText(/2028\s*12\s*6\s764,28\sDH/);
  await expect(schedule.nth(8)).toContainText(/2033\s*8\s*4\s509,52\sDH\s*47\s350,00\sDH\s*0,00\sDH/);
  const receipt = await page.request.get((await asset.getByRole("link", { name: "facture" }).getAttribute("href"))!);
  expect(Buffer.from(await receipt.body()).equals(PNG)).toBe(true);

  // FC1: D 2332 / C 5161 (CA) on the day of acquisition.
  await page.goto("/fr/books?view=journals&month=2026-09");
  const entry = page.getByRole("table").filter({ hasText: "Acquisition : Groupe électrogène" });
  await expect(entry.getByRole("row").filter({ hasText: /^2332 / })).toContainText(/47\s350,00/);
  await expect(entry.getByRole("row").filter({ hasText: /^5161 / })).toContainText(/47\s350,00/);

  // Disposed of on 15 Nov 2026: September and October are used, cumulative(2) = 1 127,38, posted by the disposal.
  await page.goto("/fr/assets");
  await asset.getByText("Céder ou mettre au rebut", { exact: true }).click();
  await asset.getByLabel("Date de cession").fill("2026-11-15");
  await asset.getByLabel("Prix de cession (0 si mise au rebut)").fill("30000");
  await asset.getByLabel("Encaissé").selectOption("bank");
  await asset.getByRole("button", { name: "Enregistrer la cession" }).click();
  await expect(asset).toContainText(/Cédée le 15 novembre 2026 pour 30\s000,00\sDH/);
  await expect(schedule).toHaveCount(2);
  await expect(schedule.nth(1)).toContainText(/2026 · jusqu’à la cession\s*2\s*1\s127,38\sDH/);
  await expect(asset.getByText("Céder ou mettre au rebut", { exact: true })).toHaveCount(0);
  await page.goto("/fr/books?view=journals&month=2026-11");
  const journal = (label: string, account: string) => page.getByRole("table").filter({ hasText: label }).getByRole("row").filter({ hasText: new RegExp(`^${account} `) });
  await expect(journal("Dotation aux amortissements : Groupe électrogène", "6193")).toContainText(/1\s127,38/);
  await expect(journal("Cession : Groupe électrogène", "6513")).toContainText(/46\s222,62/);
  await expect(journal("Prix de cession : Groupe électrogène", "7513")).toContainText(/30\s000,00/);

  // The accountant reads the register without its forms; a worker gets nothing (FX2).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/assets");
  await expect(schedule).toHaveCount(2);
  await expect(page.getByText("Ajouter une immobilisation", { exact: true })).toHaveCount(0);
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Groupe électrogène" })).toHaveCount(0);
  await expect(page.getByText("Les dépenses et la trésorerie sont réservées au propriétaire et au gérant.")).toBeVisible();

  // Arabic, right to left, for the accountant.
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/ar/assets");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الأصول الثابتة");
  await expect(page.getByRole("table", { name: "جدول الاهتلاك · Groupe électrogène" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // the tables scroll, not the page
});
