import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { batchTab, farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";
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
  await page.goto(`/fr/batches?tab=indicateurs#${ids.batch}`);
  // 4 500 DH so far ÷ (1 000 birds × 0,5 kg) = 9,00 DH per kg live
  const cost = tile(page, "Coût / kg vif");
  await expect(cost).toContainText(/9,00\sDH \/ kg/, { timeout: 30_000 }); // read from the server (FN13), slower under a parallel run
  await expect(cost).toContainText(/4.500,00\sDH\sengagés\s·\s500\skg\svifs\sestimés/);

  const chart = page.getByRole("figure");
  const tiles = page.locator("dl").filter({ has: page.getByRole("term").filter({ hasText: "Coût / kg vif" }) });
  const day = page.getByRole("button", { name: "Enregistrer la journée" });
  const weighing = page.getByRole("button", { name: "Enregistrer la pesée" });
  await beside(chart, tiles);
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize(PHONE); // the phone: one column
  await below(chart, tiles);

  await page.setViewportSize(WIDE);
  await batchTab(page, "Saisie du jour");
  await beside(day, weighing); // the daily entry and the weighings: two columns
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize(PHONE);
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
  await page.goto(`/fr/batches?tab=indicateurs#${ids.batch}`);
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
  await page.goto(`/fr/batches?tab=ventes#${ids.batch}`);
  const sales = page.getByRole("list", { name: "Ventes" }).getByRole("listitem");
  await expect(sales).toHaveCount(2);
  const byCheque = sales.filter({ hasText: "Chèque" });
  await beside(byCheque.getByText(/Abattoir Atlas · 100 oiseaux · 200\skg/), byCheque.getByText(/^3.000,00\sDH · Chèque/));
  expect(await noSideScroll(page)).toBe(true);
});

// The same wide layouts in Arabic: the columns mirrored, still no sideways scroll (ADR-004).
const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")) as Record<string, Record<string, string> & { methods: Record<string, string>; states: Record<string, string>; tabs: Record<string, string> }>;

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
  await page.goto(`/ar/batches?tab=indicateurs#${ids.batch}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const tiles = page.locator("dl").filter({ has: page.getByRole("term").filter({ hasText: ar.Kpi.costPerKg }) });
  await expect(tiles).toBeVisible({ timeout: 30_000 }); // the cost per kg is read from the server (FN13)
  await beside(page.getByRole("figure"), tiles, true);
  await batchTab(page, ar.Batches.tabs.saisie);
  await beside(page.getByRole("button", { name: ar.Day.save }), page.getByRole("button", { name: ar.Weighing.save }), true);
  await batchTab(page, ar.Batches.tabs.ventes);
  const byCheque = page.getByRole("list", { name: ar.Sale.title }).getByRole("listitem").filter({ hasText: ar.Sale.methods.cheque });
  await expect(byCheque).toHaveCount(1);
  await beside(byCheque.locator(":scope > span").nth(0), byCheque.locator(":scope > span").nth(1), true);
  expect(await noSideScroll(page)).toBe(true);

  await page.goto("/ar/receivables");
  const owing = page.getByRole("list", { name: ar.Receivables.title, exact: true });
  await expect(owing.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(ar.Receivables.colBuyer)).toBeVisible();
  await beside(owing.getByText(/^على ⁨Abattoir Atlas⁩/), owing.getByText(/0012345/), true);
  const cheque = page.getByRole("list", { name: ar.Receivables.portfolio }).getByRole("listitem");
  await beside(cheque.getByText(/0012345/), cheque.getByText(ar.Receivables.states.in_portfolio), true);
  expect(await noSideScroll(page)).toBe(true);
});

// tasks/plan-ui.md U18, Main.dc.html « A · Cockpit »: from lg the home puts its figures on top, the batches as rows
// beside the day's checklist and the money; the phone keeps its dark header and big task cards. A worker sees no money.
test("the wide home: figures on top, the batches beside the checklist, no money for a worker, the phone as before", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage du Cockpit");
  await scopeRemembered(page);
  await farmWithBatch(page, "ross-308", farmDaysAgo(5)); // 1 000 chicks, no entry: days 1 to 4 missing

  await page.setViewportSize(WIDE);
  await page.goto("/fr/dashboard");
  const figures = page.getByRole("region", { name: "Chiffres du jour" });
  await expect(figures).toContainText(/Sujets vivants\s*1.000\s*1 bande en cours/, { timeout: 30_000 });
  await expect(figures).toContainText(/Tâches restantes\s*5\s*dont 4 saisies manquantes/); // 4 missing days + today's entry
  await expect(figures).toContainText(/Trésorerie disponible\s*−?[\d.\s]+,\d\d\sDH/, { timeout: 30_000 }); // streamed in (FX2)
  await expect(figures).not.toContainText("Œufs ramassés hier"); // no laying batch: no egg figure (SPEC-m3 D1)

  const batches = page.getByRole("region", { name: "Bandes en cours" });
  const tasks = page.getByRole("region", { name: "Tâches du jour" });
  await expect(batches.getByRole("img", { name: /Jour 5 de la bande, 4 jour\(s\) non saisi\(s\)/ })).toBeVisible();
  await expect(batches).toContainText(/Bâtiment 1\s*Ross 308 · Jour 5 sur 42/);
  await expect(tasks.getByRole("link", { name: /^4 saisies manquantes, dès le/ })).toBeVisible(); // the missing days first
  await expect(tasks.getByRole("link", { name: "Saisir · Bâtiment 1" })).toHaveAttribute("href", /\/fr\/batches#/);
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toHaveCount(0); // the phone's card is hidden
  await below(figures, batches);
  await beside(batches, tasks);
  // The cash is the top row's tile, not repeated in « Argent »: with no closed batch either, no card on a wide screen.
  await expect(page.getByRole("region", { name: "Argent" })).toBeHidden();
  await expect(tasks.getByRole("list", { name: /^Saisies du jour/ }).getByRole("listitem")).toHaveText([/^Bâtiment 1\s*Saisir/]); // the house alone
  // tasks/plan-ui-cleanup.md §3: « Tout voir » and the tile open « Tâches du jour »; « Saisir » is the small primary;
  // what waits to be sent is the header's chip, not the home's.
  await expect(tasks.getByRole("link", { name: "Tout voir" })).toHaveAttribute("href", "/fr/tasks");
  await expect(figures.getByRole("link", { name: /^Tâches restantes/ })).toHaveAttribute("href", "/fr/tasks");
  expect((await box(tasks.getByRole("link", { name: "Saisir · Bâtiment 1" }))).height).toBe(32);
  await expect(page.getByRole("banner").getByRole("link", { name: "Synchronisation : Tout est envoyé" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Tout est envoyé/ })).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);

  await page.setViewportSize(PHONE); // the phone: as before
  await expect(figures).toBeHidden();
  await expect(batches).toBeHidden();
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tâches du jour" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Argent" })).toContainText("Trésorerie disponible"); // no tile on the phone

  // A worker: the same tasks, no cash figure, no money card (I5).
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.setViewportSize(WIDE);
  await page.goto("/fr/dashboard");
  await expect(tasks.getByRole("link", { name: "Saisir · Bâtiment 1" })).toBeVisible({ timeout: 30_000 });
  await expect(figures).toContainText(/Tâches restantes\s*5/);
  await expect(figures).not.toContainText("Trésorerie");
  await expect(page.getByRole("region", { name: "Argent" })).toHaveCount(0);
});

// Owner feedback: a tab bar scrolls sideways (the phone), never up and down: its current tab's border made it 1 px taller
// than itself, so Windows showed a vertical scrollbar beside « En cours / Clôturées » (that bar needs a closed batch; the
// batch page's is the same component).
test("tab bars have no vertical scroll, wide or on the phone, and still scroll sideways", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage des Onglets");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);
  const bars = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main nav")]
        .filter((nav) => nav.querySelector('a[aria-current="page"]') && nav.checkVisibility())
        .map((nav) => ({ name: nav.getAttribute("aria-label"), up: nav.scrollHeight - nav.clientHeight, sideways: getComputedStyle(nav).overflowX })),
    );
  for (const size of [WIDE, { width: 1440, height: 900 }, PHONE]) {
    await page.setViewportSize(size);
    for (const [url, name] of [[`/fr/batches#${ids.batch}`, "Sections de la bande"], ["/fr/disposal", "Registre"], ["/fr/climate", "Climat des bâtiments"]]) {
      await page.goto(url);
      await expect(page.getByRole("navigation", { name, exact: true }).getByRole("link").first()).toBeVisible();
      expect(await bars(), `${url} at ${size.width}`).toContainEqual({ name, up: 0, sideways: "auto" });
      expect((await bars()).every((b) => b.up <= 0), `${url} at ${size.width}`).toBe(true);
    }
  }
});
