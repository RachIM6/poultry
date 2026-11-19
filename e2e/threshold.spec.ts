import { expect, test } from "@playwright/test";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T37 (FN17): from 90 % of the exemption threshold, the dashboard warns and the tracker shows the year.
test("the dashboard warns from 90 % of the 5 M DH threshold, and the tracker shows the year", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage du Seuil");
  await scopeRemembered(page);
  const id = () => crypto.randomUUID();
  const [farm, house, batch, buyer] = [id(), id(), id(), id()];
  const year = farmDaysAgo(0).slice(0, 4);
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: house, farmId: farm, name: "B1", areaM2: 1000, capacity: 10000, type: "closed" } },
    { type: "flock.placeBatch", payload: { id: batch, houseId: house, strainId: "ross-308", placedOn: `${year}-01-02`, chicksPlaced: 10000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "0", dayOldWeightGrams: null } },
    { type: "sales.createBuyer", payload: { id: buyer, name: "Hamid", phone: null, type: "trader" } },
    // 306 666 kg × 15,00 = 4 599 990,00 DH this year: 91 % of 5 000 000
    { type: "sales.recordSale", payload: { id: id(), batchId: batch, buyerId: buyer, day: `${year}-01-03`, birds: 1000, farmWeightGrams: 306_666_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "credit", paidCentimes: "0", instrument: null } },
  ]);
  const posted = async () =>
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND j.journal = 'VT'`, [e164]))[0].n;
  await expect.poll(posted).toBe(1);

  await page.goto("/fr/dashboard");
  await expect(page.getByRole("alert").filter({ hasText: "Vos ventes agricoles atteignent 91 % du seuil d’exonération." })).toBeVisible();
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // tasks/plan-ui.md U2: the "Plus" tab
  await page.getByRole("link", { name: "Seuil des 5 M DH" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Seuil d’exonération : 5.000.000,00\sDH$/);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "91");
  await expect(page.getByText(/^4.599.990,00\sDH · 91 %$/)).toBeVisible();
});
