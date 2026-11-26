import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";
import { orgOf } from "./screens";

// tasks/plan-ui.md, the last mockup gaps: WebBatch and WebSales on a 1280 px screen, and the Batch mockup's live cost
// per kg tile. The phone keeps its one-column layout.
const WIDE = { width: 1280, height: 800 };
const PHONE = { width: 412, height: 915 };
const tile = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.getByRole("term").filter({ hasText: label }) });
const box = async (l: Locator) => (await l.boundingBox())!;
/** b starts after a ends, on the reading side: left to right in French, right to left in Arabic. */
const beside = async (a: Locator, b: Locator, rtl = false) =>
  rtl ? expect((await box(b)).x + (await box(b)).width).toBeLessThanOrEqual((await box(a)).x + 1) : expect((await box(b)).x).toBeGreaterThanOrEqual((await box(a)).x + (await box(a)).width - 1);
const below = async (a: Locator, b: Locator) => expect((await box(b)).y).toBeGreaterThanOrEqual((await box(a)).y + (await box(a)).height - 1);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("WebBatch: the chart beside the tiles, the sections in two columns, and the live cost per kg for money roles", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Grand Écran");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20)); // 1 000 chicks at 4,50 DH = 4 500 DH
  await pushAs(page, [{ type: "flock.recordWeighing", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(1), sample: { totalGrams: 50_000, count: 100 } } }]);

  await page.setViewportSize(WIDE);
  await page.goto(`/fr/batches#${ids.batch}`);
  // 4 500 DH so far ÷ (1 000 birds × 0,5 kg) = 9,00 DH per kg live
  const cost = tile(page, "Coût / kg vif");
  await expect(cost).toContainText(/9,00\sDH \/ kg/, { timeout: 30_000 }); // read from the server (FN13), slower under a parallel run
  await expect(cost).toContainText(/4.500,00\sDH\sengagés\s·\s500\skg\svifs\sestimés/);

  const chart = page.getByRole("figure");
  const tiles = page.locator("dl").filter({ has: page.getByRole("term").filter({ hasText: "Coût / kg vif" }) });
  const day = page.getByRole("button", { name: "Enregistrer la journée" });
  const weighing = page.getByRole("button", { name: "Enregistrer la pesée" });
  await beside(chart, tiles);
  await beside(day, weighing); // the daily entry and the weighings: two columns
  expect(await noSideScroll(page)).toBe(true);

  await page.setViewportSize(PHONE); // the phone: one column
  await below(chart, tiles);
  await below(day, weighing);

  // Workers never see it (I5): the phone forgets the money with the role.
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  const role = () =>
    page.evaluate(
      () =>
        new Promise<string | undefined>((resolve) => {
          const req = indexedDB.open("poultry-device");
          req.onsuccess = () => {
            const get = req.result.transaction("session").objectStore("session").get("current");
            get.onsuccess = () => (req.result.close(), resolve(get.result?.scope?.role));
          };
        }),
    );
  await expect.poll(role).toBe("worker");
  await page.goto(`/fr/batches#${ids.batch}`);
  await expect(tile(page, "Mortalité")).toBeVisible();
  await expect(tile(page, "Coût / kg vif")).toHaveCount(0);
});

test("WebSales: receivables and a batch's sales read as tables on a wide screen, cards on the phone", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage des Colonnes");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(30));
  const buyer = crypto.randomUUID();
  // 200 kg × 15 DH = 3 000 DH each
  const sale = { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(1), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500" };
  await pushAs(page, [
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    {
      type: "sales.recordSale",
      payload: { ...sale, paymentMethod: "cheque", paidCentimes: "300000", instrument: { number: "0012345", dueOn: farmDaysAgo(-10) } }, // in the portfolio
    },
    { type: "sales.recordSale", payload: { ...sale, id: crypto.randomUUID(), paymentMethod: "credit", paidCentimes: "50000", instrument: null } }, // 2 500 DH owed
  ]);

  await page.setViewportSize(WIDE);
  await page.goto("/fr/receivables");
  const owes = page.getByText(/^Abattoir Atlas doit/);
  await expect(owes).toHaveText(/doit 2.500,00\sDH$/);
  const owing = page.getByRole("list", { name: "Créances des acheteurs", exact: true });
  await expect(owing.getByRole("listitem")).toHaveCount(1); // the header row is not an item
  const due = owing.getByText(/^Chèque n° 0012345/);
  await expect(page.getByText("Acheteur et solde")).toBeVisible();
  await beside(owes, due); // one row, in columns
  const cheque = page.getByRole("list", { name: "Chèques et traites reçus" }).getByRole("listitem");
  await beside(cheque.getByText(/^Chèque n° 0012345/), cheque.getByText("En portefeuille"));
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize(PHONE);
  await below(owes, due);
  await expect(page.getByText("Acheteur et solde")).toBeHidden();

  await page.setViewportSize(WIDE);
  await page.goto(`/fr/batches#${ids.batch}`);
  const sales = page.getByRole("list", { name: "Ventes" }).getByRole("listitem");
  await expect(sales).toHaveCount(2);
  const byCheque = sales.filter({ hasText: "Chèque" });
  await beside(byCheque.getByText(/Abattoir Atlas · 100 oiseaux · 200\skg/), byCheque.getByText(/^3.000,00\sDH · Chèque/));
  expect(await noSideScroll(page)).toBe(true);
});

// The same wide layouts in Arabic: the columns mirrored, still no sideways scroll (ADR-004).
const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")) as Record<string, Record<string, string> & { methods: Record<string, string>; states: Record<string, string> }>;

test("WebBatch and WebSales in Arabic: the same columns, right to left", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Grand Écran Arabe");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(30));
  const buyer = crypto.randomUUID();
  const sale = { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(1), birds: 100, farmWeightGrams: 200_000, buyerWeightGrams: null, pricePerKgCentimes: "1500" };
  await pushAs(page, [
    { type: "flock.recordWeighing", payload: { id: uuidv7(), batchId: ids.batch, day: farmDaysAgo(2), sample: { totalGrams: 150_000, count: 100 } } },
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    { type: "sales.recordSale", payload: { ...sale, paymentMethod: "cheque", paidCentimes: "300000", instrument: { number: "0012345", dueOn: farmDaysAgo(-10) } } },
    { type: "sales.recordSale", payload: { ...sale, id: crypto.randomUUID(), paymentMethod: "credit", paidCentimes: "50000", instrument: null } },
  ]);

  await page.setViewportSize(WIDE);
  await page.goto(`/ar/batches#${ids.batch}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const tiles = page.locator("dl").filter({ has: page.getByRole("term").filter({ hasText: ar.Kpi.costPerKg }) });
  await expect(tiles).toBeVisible({ timeout: 30_000 }); // the cost per kg is read from the server (FN13)
  await beside(page.getByRole("figure"), tiles, true);
  await beside(page.getByRole("button", { name: ar.Day.save }), page.getByRole("button", { name: ar.Weighing.save }), true);
  const byCheque = page.getByRole("list", { name: ar.Sale.title }).getByRole("listitem").filter({ hasText: ar.Sale.methods.cheque });
  await expect(byCheque).toHaveCount(1);
  await beside(byCheque.locator(":scope > span").nth(0), byCheque.locator(":scope > span").nth(1), true);
  expect(await noSideScroll(page)).toBe(true);

  await page.goto("/ar/receivables");
  const owing = page.getByRole("list", { name: ar.Receivables.title, exact: true });
  await expect(owing.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(ar.Receivables.colBuyer)).toBeVisible();
  await beside(owing.getByText(/^على Abattoir Atlas/), owing.getByText(/0012345/), true);
  const cheque = page.getByRole("list", { name: ar.Receivables.portfolio }).getByRole("listitem");
  await beside(cheque.getByText(/0012345/), cheque.getByText(ar.Receivables.states.in_portfolio), true);
  expect(await noSideScroll(page)).toBe(true);
});
