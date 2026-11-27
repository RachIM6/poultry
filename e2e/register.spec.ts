import { expect, test, type Page } from "@playwright/test";
import { controlled, farmDaysAgo, ownerWithFarm, pushAs, referenceCached, scopeRemembered } from "./auth";

// T47 acceptance: a batch's ONSSA register prints offline in French and in Arabic, with its cover, daily rows, birds
// out and disposals, the vet visa grid and the legal reference (arrêté n° 2126-05), and nothing wider than an A4 page. PDFs are kept in test-results/.
// Owner feedback (tasks/plan-ui.md): the page is in the app's shell; on paper, the register alone.
const PARTS = ["cover", "supervision", "daily", "treatments", "vaccinations", "birdsOut", "disposals", "labReports", "visas", "annexes"];
async function printsOnA4(page: Page, name: string, title: string) {
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.getByRole("button", { name: /Imprimer|طباعة/ })).toBeHidden();
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Sommaire" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title); // the register's own, not the page's
  for (const part of PARTS) await expect(page.locator(`#${part}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath(`${name}.pdf`) });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 412, height: 839 });
}

test("a batch's register prints offline, in French and in Arabic", async ({ page, context }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage du Registre");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID(), buyer: crypto.randomUUID(), sale: crypto.randomUUID() };
  await pushAs(page, [
    {
      type: "farm-registry.createFarm",
      payload: { id: ids.farm, name: "Ferme El Kheir", region: "Casablanca-Settat", province: "Settat", commune: "Ouled Said", gps: null, onssa: { number: "AV-2026-0412", expiresOn: "2027-03-15" } },
    },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1000, capacity: 10000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: farmDaysAgo(36), chicksPlaced: 1000, deadOnArrival: 2, hatchery: "Couvoir Chaouia", deliveryNote: "CC-26-0974", chickUnitPriceCentimes: "450", dayOldWeightGrams: null },
    },
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(1), changes: { dead: 4, deathCause: "leg", culled: 1 } } },
    { type: "biosecurity.recordDisposal", payload: { id: crypto.randomUUID(), farmId: ids.farm, day: farmDaysAgo(1), batchId: ids.batch, birds: 5, weightGrams: 9800, method: "incineration", methodNote: null } },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Abattoir Doukkala", phone: null, type: "abattoir" } },
    {
      type: "sales.recordSale",
      payload: { id: ids.sale, batchId: ids.batch, buyerId: ids.buyer, day: farmDaysAgo(0), birds: 300, farmWeightGrams: 660_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "990000", instrument: null },
    },
  ]);

  await page.goto(`/fr/batches?tab=ventes#${ids.batch}`);
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Registre de suivi sanitaire (Français)" })).toBeVisible();
  await expect(page.getByText("Abattoir Doukkala")).toBeVisible(); // the sale is on the phone
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("link", { name: "Registre de suivi sanitaire (Français)" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/register#${ids.batch}/fr$`));
  const doc = page.getByRole("article");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("Registre de suivi sanitaire · Bâtiment 1"); // the page's: the register's own h1 is for paper
  await expect(page.getByRole("main")).toContainText(/Ferme El Kheir · Bande mise en place le /);
  await page.reload(); // a precached shell: it opens offline
  await expect(h1).toHaveText("Registre de suivi sanitaire · Bâtiment 1");
  for (const text of [
    "Ferme El Kheir",
    "Ouled Said, Settat, Casablanca-Settat",
    "AV-2026-0412",
    "Bâtiment 1 · 1 000 m²",
    "Ross 308",
    "Couvoir Chaouia · CC-26-0974",
    "Pattes",
    "Abattoir Doukkala",
    ids.sale.slice(0, 8).toUpperCase(),
    "Incinération",
    "Arrêté n° 2126-05 du 15 décembre 2005 (décret n° 2-04-684, art. 8)",
    "Visas du vétérinaire sanitaire (art. 7)",
    "Visa du détenteur",
    "Pièces à joindre",
  ]) {
    await expect(doc).toContainText(text);
  }
  const daily = doc.getByRole("table").first();
  await expect(daily.getByRole("row").nth(1)).toContainText(/35\s*993\s*4\s*1/); // 1 000 − 2 at arrival − 4 dead − 1 culled
  await expect(daily.getByRole("row").nth(2)).toContainText(/36\s*693\s*0\s*0/); // the sale's day, with no daily entry: 993 − 300 sold

  // The contents: a row of links on the phone, each part one click away, the hash (the batch) unchanged.
  const contents = page.getByRole("navigation", { name: "Sommaire" });
  await expect(contents.getByRole("link")).toHaveCount(PARTS.length);
  const url = page.url();
  await contents.getByRole("link", { name: "Visas du vétérinaire sanitaire (art. 7)" }).click();
  await expect(page.locator("#visas")).toBeFocused();
  expect(page.url()).toBe(url);

  // Wide: the header bar and the sidebar, the contents beside the register and in view, the back link to the batch;
  // nothing leads to /more, and no app language switch on the page (the header's menu has it): only the register's.
  const sidebar = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(sidebar.getByRole("link", { name: "Plus", exact: true })).toBeVisible(); // the phone keeps its tab
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimer ou enregistrer en PDF" })).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('a[href$="/more"]')].filter((a) => a.checkVisibility()).length)).toBe(0);
  await expect(page.getByRole("navigation", { name: "Langue", exact: true })).toBeHidden();
  const language = page.getByRole("navigation", { name: "Langue du registre" });
  await expect(language.getByRole("link", { name: "Français" })).toHaveAttribute("aria-current", "true");
  await page.locator("#annexes").scrollIntoViewIfNeeded();
  await expect(contents).toBeInViewport();
  await expect(page.getByRole("link", { name: "Retour" })).toHaveAttribute("href", `/fr/batches#${ids.batch}`);
  await page.setViewportSize({ width: 412, height: 839 });
  await printsOnA4(page, "register-fr", "Registre de suivi sanitaire");

  // The register in Arabic, the app still in French: from the page's switch, then from the batch's link.
  await language.getByRole("link", { name: "العربية" }).click();
  const arabic = page.locator('[lang="ar"][dir="rtl"]');
  await expect(arabic.getByRole("article")).toContainText("القرار رقم 2126-05");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(h1).toHaveText("Registre de suivi sanitaire · Bâtiment 1");
  await expect(doc.locator('bdi[dir="ltr"]').first()).toHaveText("AV-2026-0412");
  await printsOnA4(page, "register-ar", "سجل التتبع الصحي");
  await page.getByRole("link", { name: "Retour" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/batches#${ids.batch}$`));
  await page.getByRole("link", { name: "Registre de suivi sanitaire (العربية)" }).click();
  await expect(page).toHaveURL(new RegExp(`/fr/register#${ids.batch}/ar$`));
  await expect(arabic.getByRole("article")).toContainText("القرار رقم 2126-05");

  // The app in Arabic keeps the batch and the register's language (#id/lang): the page around it changes, not the register.
  await page.goto(`/ar/register#${ids.batch}/fr`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(h1).toHaveText("سجل التتبع الصحي · Bâtiment 1");
  await expect(page.locator('[lang="fr"][dir="ltr"]').getByRole("article")).toContainText("Ferme El Kheir");
  await page.goto(`/ar/register#${ids.batch}`); // no language: the app's
  await expect(page.locator('[lang="ar"][dir="rtl"]').getByRole("article")).toContainText("القرار رقم 2126-05");
});
