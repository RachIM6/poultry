import { expect, test } from "@playwright/test";
import { batchTab, controlled, farmWithBatch, outboxEmpty, ownerWithFarm, query, queuedWrites, scopeRemembered } from "./auth";

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
  await controlled(page);
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  await page.getByLabel("Morts", { exact: true }).fill("3");
  await page.getByRole("radio", { name: "Chaleur" }).check(); // tasks/plan-ui.md U3: cause chips
  await page.getByLabel("Aliment consommé (kg)", { exact: true }).fill("85");
  await page.getByLabel("Eau (litres, facultatif)", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Enregistrer la journée" }).click();
  await expect(page.getByRole("status")).toHaveText("Enregistré sur ce téléphone. L’envoi se fait dès qu’il y a du réseau.");
  await expect(page.getByText(/Oiseaux présents : 997/)).toBeVisible();

  await page.getByLabel("Aliment consommé (kg)", { exact: true }).fill("90"); // the same day, corrected
  const queued = await queuedWrites(page);
  await page.getByRole("button", { name: "Enregistrer la journée" }).click();
  // The status already shows the first save: wait for the second one to be queued before leaving the page.
  await expect.poll(() => queuedWrites(page)).toBe(queued + 1);
  await page.goto("/fr/stock");
  await expect(page.getByText(/En stock : 910.kg/)).toBeVisible(); // 1 000 − 90, not − 85 − 90

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
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
  await page.getByLabel("النافق", { exact: true }).fill("2");
  await page.getByLabel("العلف", { exact: true }).selectOption({ label: "بدون علف هذا اليوم" });
  await page.getByRole("button", { name: "حفظ اليوم" }).click();
  await expect(page.getByText(/الطيور الموجودة: 998/)).toBeVisible();
  await batchTab(page, "الصحة");
  await page.getByText("الأمراض الواجب التصريح بها", { exact: true }).click(); // V1, in Arabic
  await expect(page.getByText("مرض الجمبورو", { exact: true })).toBeVisible();
  await expect(page.getByText("الظهير بمثابة قانون رقم 1-75-292، الفصلان 1 و3؛ القرارات رقم 3308-17 و2466-17 و2836-17، المادة 1", { exact: true })).toBeVisible();
  await outboxEmpty(page);
  const dead = async () =>
    (await query<{ dead: number }>(`SELECT d.dead FROM "DailyEntry" d JOIN "Membership" m ON m."organizationId" = d."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164]))[0]?.dead;
  await expect.poll(dead).toBe(2);
});

// Owner feedback: the stepper's focus ring goes round the whole − value + control, as on a field (WCAG 2.4.7); on the
// input alone it cut through the − and + buttons. Each button keeps its own ring. Phone and wide screens.
test("the stepper shows its focus ring round the whole control, and each button its own", async ({ page }) => {
  test.setTimeout(60_000);
  await ownerWithFarm(page, "Élevage du Focus");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/batches");
  await page.getByRole("link", { name: "Saisir le jour" }).click();
  const dead = page.getByLabel("Morts", { exact: true });
  const control = dead.locator("xpath=.."); // the − value + box
  const ring = (el: Element) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth, border: s.borderTopColor };
  };
  for (const size of [{ width: 412, height: 915 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await dead.click();
    expect(await dead.evaluate(ring)).toMatchObject({ style: "none" });
    expect(await control.evaluate(ring)).toEqual({ style: "solid", width: "3px", border: "rgb(36, 33, 28)" }); // ink
    await page.keyboard.press("Tab"); // to « + »
    const plus = page.getByRole("button", { name: "Plus 1 · Morts" });
    await expect(plus).toBeFocused();
    expect(await plus.evaluate(ring)).toMatchObject({ style: "solid", width: "3px" });
    expect(await control.evaluate(ring)).toMatchObject({ style: "none" });
  }
});
