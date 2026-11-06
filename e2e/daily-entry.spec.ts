import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T16 acceptance (browser part): the daily entry offline, its feed as one consumption movement, edited not duplicated.
// The two-phones merge is tested on the server (src/modules/flock/daily-entries.int.test.ts). "Under 60 s" is timed
// by hand with testers.
test("the day's entry works offline; its feed lowers stock once, and editing the kg updates it", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage du Jour");
  await scopeRemembered(page);
  await farmWithBatch(page);

  await page.goto("/fr/stock");
  await expect(page.getByText(/En stock : 1.000.kg/)).toBeVisible(); // pulled: the phone has the stock, then precache
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  await page.getByLabel("Morts").fill("3");
  await page.getByLabel("Cause").selectOption({ label: "Chaleur" });
  await page.getByLabel("Aliment consommé (kg)").fill("85");
  await page.getByLabel("Eau (litres, facultatif)").fill("150");
  await page.getByRole("button", { name: "Enregistrer la journée" }).click();
  await expect(page.getByRole("status")).toHaveText("Enregistré sur ce téléphone. L’envoi se fait dès qu’il y a du réseau.");
  await expect(page.getByText(/Oiseaux présents : 997/)).toBeVisible();

  await page.getByLabel("Aliment consommé (kg)").fill("90"); // the same day, corrected
  await page.getByRole("button", { name: "Enregistrer la journée" }).click();
  await page.goto("/fr/stock");
  await expect(page.getByText(/En stock : 910.kg/)).toBeVisible(); // 1 000 − 90, not − 85 − 90

  await context.unroute("**");
  await context.setOffline(false);
  const server = async () =>
    await query<{ dead: number; feed: number; movements: number; quantity: number }>(
      `SELECT d.dead, d."feedGrams" AS feed,
              (SELECT count(*)::int FROM "StockMovement" s WHERE s.kind = 'consumption' AND s."organizationId" = d."organizationId") AS movements,
              (SELECT s.quantity FROM "StockMovement" s WHERE s.id = d.id) AS quantity
       FROM "DailyEntry" d JOIN "Membership" m ON m."organizationId" = d."organizationId"
       JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ dead: 3, feed: 90_000, movements: 1, quantity: -90_000 }]);
});

test("the day's entry in Arabic, right to left", async ({ page }) => {
  test.setTimeout(60_000);
  const e164 = await ownerWithFarm(page, "ضيعة اليوم");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/ar/batches");
  await page.getByRole("link", { name: "تسجيل اليوم" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("النافق").fill("2");
  await page.getByLabel("العلف", { exact: true }).selectOption({ label: "بدون علف هذا اليوم" });
  await page.getByRole("button", { name: "حفظ اليوم" }).click();
  await expect(page.getByText(/الطيور الموجودة: 998/)).toBeVisible();
  const dead = async () =>
    (await query<{ dead: number }>(`SELECT d.dead FROM "DailyEntry" d JOIN "Membership" m ON m."organizationId" = d."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0]?.dead;
  await expect.poll(dead).toBe(2);
});
