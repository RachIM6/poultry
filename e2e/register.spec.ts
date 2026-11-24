import { expect, test, type Page } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, referenceCached, scopeRemembered } from "./auth";

// T47 acceptance: a batch's ONSSA register prints offline in French and in Arabic, with its cover, daily rows, birds
// out and disposals, the vet visa grid and the legal reference (arrêté n° 2126-05), and nothing wider than an A4 page. PDFs are kept in test-results/.
async function printsOnA4(page: Page, name: string) {
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.getByRole("button", { name: /Imprimer|طباعة/ })).toBeHidden();
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

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Registre de suivi sanitaire (Français)" })).toBeVisible();
  await expect(page.getByText("Abattoir Doukkala")).toBeVisible(); // the sale is on the phone
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("link", { name: "Registre de suivi sanitaire (Français)" }).click();
  const doc = page.getByRole("article");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("Registre de suivi sanitaire");
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
  await printsOnA4(page, "register-fr");

  await page.goBack();
  await page.getByRole("link", { name: "Registre de suivi sanitaire (العربية)" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("سجل التتبع الصحي");
  await expect(doc).toContainText("القرار رقم 2126-05");
  await expect(doc.locator('bdi[dir="ltr"]').first()).toHaveText("AV-2026-0412");
  await printsOnA4(page, "register-ar");
});
