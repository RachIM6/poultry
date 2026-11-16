import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T48 acceptance (browser part): a closed batch's report shows its figures and the same margin as /results, which
// both read from finance's batch result (SPEC-m2-compliance RP3, D7). The builder: reporting/domain/report.test.ts.
test("a closed batch's report shows its figures and the margin of /results", async ({ page }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage du Rapport");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(40));
  const buyer = crypto.randomUUID();
  await pushAs(page, [
    { type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(10), changes: { dead: 20, deathCause: "unknown", culled: 0, feed: { stockItemId: ids.feed, grams: 900_000 } } } },
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Doukkala", phone: null, type: "abattoir" } },
    {
      type: "sales.recordSale",
      payload: { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(0), birds: 980, farmWeightGrams: 2_400_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3600000", instrument: null },
    },
  ]);

  await page.goto("/fr/results");
  const resultRow = page.getByRole("row").nth(1);
  await expect(resultRow).toBeVisible();
  const margin = (await resultRow.getByRole("cell").nth(3).innerText()).trim();

  await page.goto(`/fr/batches#${ids.batch}`);
  await page.getByRole("link", { name: "Rapport de bande" }).click();
  const doc = page.getByRole("article");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("Rapport de bande");
  await expect(doc).toContainText(/Clôturée le/);
  await expect(doc).toContainText("1 000"); // chicks placed
  await expect(doc).toContainText(/20 · 2,0\s%/); // dead and mortality
  await expect(doc).toContainText(/980\s+·\s+2\s*400\s+kg/);
  await expect(doc).toContainText("Vaccins faits : 0 sur 0");
  await expect(doc.getByText("Marge", { exact: true }).locator("..")).toContainText(margin);
  await expect(doc.getByRole("table", { name: "Comparaison avec les bandes précédentes de la ferme" }).getByRole("row")).toHaveCount(2);
});
