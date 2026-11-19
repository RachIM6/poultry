import { expect, test, type Page } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, referenceCached, scopeRemembered } from "./auth";

// T23 acceptance: a sale's origin document, offline, in French and in Arabic (right to left), with every field of the
// task, printed on one A4 page with nothing wider than the page. The PDFs are kept in test-results/ for a look.

/** Print media, A4 width at 96 dpi: the document fits the page width, and it prints as one A4 page. */
async function printsOnOneA4Page(page: Page, name: string) {
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  await expect(page.getByRole("button", { name: /Imprimer|طباعة/ })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath(`${name}.pdf`) });
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 412, height: 839 });
}

test("a sale's origin document prints offline on one A4 page, in French and in Arabic", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage d’Origine");
  await scopeRemembered(page);
  const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), batch: crypto.randomUUID(), buyer: crypto.randomUUID(), sale: crypto.randomUUID() };
  await pushAs(page, [
    {
      type: "farm-registry.createFarm",
      payload: { id: ids.farm, name: "Ferme Atlas", region: "Fès-Meknès", province: "El Hajeb", commune: "Aït Boubidmane", gps: null, onssa: { number: "AV-2024-0123", expiresOn: "2027-12-31" } },
    },
    { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 2", areaM2: 1200, capacity: 12000, type: "closed" } },
    {
      type: "flock.placeBatch",
      payload: { id: ids.batch, houseId: ids.house, strainId: "ross-308", placedOn: farmDaysAgo(35), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null },
    },
    { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Abattoir Atlas", phone: "0612345678", type: "abattoir" } },
    {
      type: "sales.recordSale",
      payload: { id: ids.sale, batchId: ids.batch, buyerId: ids.buyer, day: farmDaysAgo(0), birds: 300, farmWeightGrams: 660_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "990000", instrument: null },
    },
  ]);

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  await expect(page.getByRole("link", { name: "Document d’origine (Français)" })).toBeVisible(); // pulled
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("link", { name: "Document d’origine (Français)" }).click();
  const doc = page.getByRole("article");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("Document d’origine des volailles");
  for (const text of [
    "Loi n° 49-99, article 10",
    `N° ${ids.sale.slice(0, 8).toUpperCase()}`,
    "Ferme Atlas",
    "Aït Boubidmane, El Hajeb, Fès-Meknès",
    "AV-2024-0123, valable jusqu’au 31 décembre 2027",
    "Bâtiment 2",
    "Ross 308",
    "35 jours",
    "300",
    "660 kg",
    "2,2 kg",
    "Abattoir Atlas",
    "0612345678",
    "Signature et cachet de l’éleveur",
    "Signature de l’acheteur",
  ]) {
    await expect(doc).toContainText(text);
  }
  await printsOnOneA4Page(page, "origin-fr");

  await page.goBack();
  await page.getByRole("link", { name: "Document d’origine (العربية)" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("وثيقة مصدر الدواجن");
  for (const text of ["القانون رقم 49-99، المادة 10", "Ferme Atlas", "35 يوم", "توقيع وختم المربي", "توقيع المشتري"]) {
    await expect(doc).toContainText(text);
  }
  await expect(doc.locator('bdi[dir="ltr"]')).toHaveText("AV-2024-0123"); // the code keeps its order in right-to-left text
  await printsOnOneA4Page(page, "origin-ar");
});
