import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T107 (SPEC-finance FC3): the year-end count sheet lists the farm's open batches and stock items on the fiscal year's
// last day, prints with an empty "Compté" column and no amount, then takes the counts and shows the gaps. Saving,
// roles and the audit: src/modules/finance/count.int.test.ts.
test("the year-end count sheet lists every open batch and stock item, prints without an amount, and shows the gaps", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de l’Inventaire");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(10)); // 1 000 chicks, 1 000 kg of feed
  const vaccine = crypto.randomUUID();
  await pushAs(page, [
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(9), changes: { dead: 5, culled: 0, feed: null } } },
    { type: "inventory.createStockItem", payload: { id: vaccine, farmId: ids.farm, productId: null, kind: "vaccine", name: "HB1", unit: "dose", lot: "L-77", expiresOn: farmDaysAgo(5) } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: vaccine, day: farmDaysAgo(10), quantity: 1000, unitPriceCentimes: "35", paidCentimes: "0", dueOn: null } },
  ]);

  await page.goto("/fr/dashboard");
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // FCX2: "Plus" › Argent
  await page.getByRole("link", { name: "Inventaire de fin d’exercice" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inventaire de fin d’exercice");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(/^Ferme Atlas · inventaire au /);
  const batches = page.getByRole("table", { name: "Bandes en cours" }).getByRole("row");
  await expect(batches).toHaveCount(2);
  await expect(batches.nth(1)).toContainText(/Bâtiment 1\s*Poulet de chair\s*995 sujets/);
  const stock = page.getByRole("table", { name: "Stocks" }).getByRole("row");
  await expect(stock).toHaveCount(3);
  await expect(stock.filter({ hasText: "Démarrage" })).toContainText(/Aliment · Démarrage\s*1\s000\skg/);
  await expect(stock.filter({ hasText: "HB1" })).toContainText(/Vaccin · HB1\s*L-77.*Périmé\s*1\s000 doses/);

  // Paper: an empty "Compté" column, no price, value or amount anywhere in the sheet, within an A4 width.
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.getByRole("textbox", { name: /^Compté : / })).toHaveCount(0); // hidden on paper
  await expect(page.getByRole("columnheader", { name: "Compté" })).toHaveCount(2);
  await expect(page.getByRole("columnheader", { name: "Écart" })).toHaveCount(0);
  const html = await page.locator("main:visible").innerHTML(); // earlier pages stay in the DOM, hidden, after client navigation
  expect(html).not.toMatch(/\bDH\b|MAD|prix|valeur|montant|centime/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath("count-fr.pdf") });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 412, height: 915 }); // back to the phone

  // Online: the counts, saved, and the gaps with where to correct the books.
  await page.getByRole("textbox", { name: "Compté : Bâtiment 1 · Poulet de chair" }).fill("990");
  await page.getByRole("textbox", { name: "Compté : Démarrage" }).fill("980");
  await page.getByRole("button", { name: "Enregistrer le comptage" }).click();
  await expect(page.getByRole("status")).toHaveText("Comptage enregistré.");
  await expect(batches.nth(1)).toContainText("−5 sujets");
  await expect(batches.nth(1).getByRole("link", { name: "Saisie du jour" })).toHaveAttribute("href", `/fr/batches#${ids.batch}`);
  await expect(stock.filter({ hasText: "Démarrage" })).toContainText(/−20\skg/);
  await expect(stock.filter({ hasText: "Démarrage" }).getByRole("link", { name: "Corriger le stock" })).toHaveAttribute("href", "/fr/stock");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Compté : Démarrage" })).toHaveValue("980");

  // Arabic, right to left.
  await page.goto("/ar/closing/count");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("جرد نهاية السنة المالية");
  await expect(page.getByRole("table", { name: "الأفواج الجارية" }).getByRole("row").nth(1)).toContainText("−5");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); // the tables scroll, not the page
});
