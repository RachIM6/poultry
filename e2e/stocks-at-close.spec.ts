import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

// T108 (SPEC-finance FC5, FQ20): 20 t of feed bought in 2026 for §7's 98 400,00, counted at the year end; the close
// preview values it on 3121 / 612412, the owner lowers it to 97 300,00 for a provision of 1 100,00, posts both, and
// finds them in the journal on 31 December. The last day's cost, the PCA off, the reversals and the roles in detail:
// src/modules/finance/stocks.int.test.ts.
test("the owner counts a stock item, reads its value at cost in the close preview, lowers it for a provision, and posts both", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Stocks de clôture");
  await query(`UPDATE "LegalEntity" SET books = 'ledger' WHERE "organizationId" = ${orgOf}`, [e164]);
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID() };
  const purchase = (day: string, unitPriceCentimes: string) => ({
    type: "inventory.recordPurchase",
    payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: ids.feed, day, quantity: 10_000_000, unitPriceCentimes, paidCentimes: "0", dueOn: null },
  });
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf", phone: null } },
    { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Croissance", unit: "kg", lot: null, expiresOn: null } },
    purchase("2026-03-01", "480"), // 10 t at 4,80
    purchase("2026-10-01", "504"), // 10 t at 5,04: 98 400,00 for 20 t
  ]);

  // The count (FC3): the quantity the close values.
  await page.goto("/fr/closing/count?year=2026");
  await page.getByRole("textbox", { name: "Compté : Croissance" }).fill("20 000");
  await page.getByRole("button", { name: "Enregistrer le comptage" }).click();
  await expect(page.getByRole("status")).toHaveText("Comptage enregistré.");

  // The preview: D 3121 / C 612412 at cost, the line with its quantity and value.
  await page.goto("/fr/closing?year=2026");
  const stock = page.getByRole("region", { name: "Stocks", exact: true });
  await expect(stock).toContainText("À comptabiliser.");
  const entry = stock.getByRole("table", { name: "Écriture · Stocks" }).getByRole("row");
  await expect(entry).toHaveCount(3);
  await expect(entry.nth(1)).toContainText(/^3121 Matières premières\s*98\s400,00/);
  await expect(entry.nth(2)).toContainText(/^612412 Variation des stocks de matières premières Agricoles – Animaux\s*98\s400,00/);
  const line = stock.getByRole("table", { name: "Stocks au coût moyen pondéré" }).getByRole("row").filter({ hasText: "Croissance" });
  await expect(line).toContainText(/Aliment · Croissance\s*Ferme Atlas\s*20\s000\skg\s*98\s400,00\sDH/);
  await expect(page.getByRole("region", { name: "Provisions pour dépréciation" })).toContainText("Rien à passer pour cet exercice.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // fits the phone

  // §7 stockAtCloseValue: the owner's 97 300,00, a provision of 1 100,00 (D 6196 / C 3912).
  await stock.getByRole("textbox", { name: "Valeur actuelle : Aliment · Croissance" }).fill("97 300");
  await stock.getByRole("button", { name: "Enregistrer les valeurs actuelles" }).click();
  await expect(stock.getByRole("status")).toHaveText("Valeurs actuelles enregistrées.");
  await expect(line).toContainText(/1\s100,00\sDH$/);
  const provision = page.getByRole("region", { name: "Provisions pour dépréciation" });
  const provisionRows = provision.getByRole("table", { name: "Écriture · Provisions pour dépréciation" }).getByRole("row");
  await expect(provisionRows.nth(1)).toContainText(/^6196 Dotations d’exploitation aux provisions pour dépréciations de l’actif circulant\s*1\s100,00/);
  await expect(provisionRows.nth(2)).toContainText(/^3912 Provisions pour dépréciation des matières et fournitures\s*1\s100,00/);

  // Posted: both entries, then the values are frozen with the count.
  await page.getByRole("button", { name: "Comptabiliser les écritures de clôture" }).click();
  await expect(page.getByText("Écritures comptabilisées : 2.")).toBeVisible();
  await expect(stock).toContainText("Comptabilisée, sans changement.");
  await expect(provision).toContainText("Comptabilisée, sans changement.");
  await expect(stock.getByText("Valeurs figées : les écritures de clôture de cet exercice sont comptabilisées.")).toBeVisible();
  await expect(stock.getByRole("textbox")).toHaveCount(0);
  await expect(line).toContainText(/97\s300,00\sDH/);

  await page.goto("/fr/books?view=journals&month=2026-12");
  const posted = page.getByRole("table").filter({ hasText: "31 décembre 2026 · Stocks de fin d’exercice" });
  await expect(posted.getByRole("row").filter({ hasText: /^3121 / })).toContainText(/98\s400,00/);
  await expect(posted.getByRole("row").filter({ hasText: /^612412 / })).toContainText(/98\s400,00/);
  const provisioned = page.getByRole("table").filter({ hasText: "31 décembre 2026 · Provisions pour dépréciation de l’actif circulant" });
  await expect(provisioned.getByRole("row").filter({ hasText: /^6196 / })).toContainText(/1\s100,00/);

  // The accountant reads the lines without a field or a button (FCX1).
  await query(`UPDATE "Membership" SET role = 'accountant' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/closing?year=2026");
  await expect(page.getByRole("region", { name: "Stocks", exact: true }).getByRole("row").filter({ hasText: "Croissance" })).toContainText(/97\s300,00\sDH/);
  await expect(page.getByRole("button", { name: "Enregistrer les valeurs actuelles" })).toHaveCount(0);

  // Arabic, right to left: the tables scroll, not the page.
  await page.goto("/ar/closing?year=2026");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("region", { name: "المخزونات", exact: true })).toContainText("3121");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
