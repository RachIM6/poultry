import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { farmDaysAgo, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";
import { unzip } from "../src/test/unzip";

// T36 (FN16): an individual farmer (cash_book) sees their receipts-and-expenses book; the ledger views are tested on
// the server (src/modules/finance/books.int.test.ts).
test("an individual farmer's books are the receipts-and-expenses book", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Livres");
  await scopeRemembered(page);
  const box = crypto.randomUUID();
  await pushAs(page, [
    { type: "finance.createTreasuryAccount", payload: { id: box, kind: "cash", name: "Caisse" } },
    { type: "finance.recordExpense", payload: { id: crypto.randomUUID(), day: farmDaysAgo(0), category: "water", amountCentimes: "45000", paidFrom: "cash", treasuryId: box, note: null, batchId: null, serviceMonth: null } },
  ]);
  const posted = async () =>
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "JournalEntry" j JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0].n;
  await expect.poll(posted).toBe(1);

  await page.goto("/fr/dashboard");
  await page.getByRole("link", { name: "Comptabilité" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Livre des recettes et dépenses");
  await expect(page.getByRole("link", { name: "Balance" })).toHaveCount(0); // a cash_book entity has no ledger views
  const book = page.getByRole("table", { name: "Recettes et dépenses" });
  await expect(book.getByRole("row").nth(1)).toContainText(/Dépense · Consommation d’Eau.*5161 Caisses.*450,00\sDH/);
  await expect(book.getByRole("row").last()).toContainText(/Total du mois\s*0,00\sDH\s*450,00\sDH/);

  // T38 (FN18): the month for the accountant, as a zip of CSV and Excel.
  const month = farmDaysAgo(0).slice(0, 7);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exporter pour le comptable (CSV, Excel)" }).click()]);
  expect(download.suggestedFilename()).toBe(`comptabilite-${month}.zip`);
  const files = unzip(await readFile(await download.path()));
  expect([...files.keys()]).toEqual([`recettes-depenses-${month}.csv`, `livres-${month}.xlsx`]);
  expect(files.get(`recettes-depenses-${month}.csv`)).toMatch(/;5161;Caisses;[^;]+;0,00;450,00\r\nTotal;;;;;0,00;450,00\r\n$/);
});
