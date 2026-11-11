import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { farmDaysAgo, login, pushAs, query, randomMobile, referenceCached, scopeRemembered } from "./auth";

// Checkpoint G (SPEC §9.2): the M1 offline journey, in each language on a phone: create a batch → 3 daily entries →
// weighing → vaccine done → reload → online → synced → visible on a second device. Every label comes from the app's
// own messages, so the Arabic run checks the Arabic screens. Setup (farm, stock, protocol) goes through the sync push.

type Messages = Record<string, Record<string, unknown>>;
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;

for (const locale of ["fr", "ar"] as const) {
  test(`M1 offline journey in ${locale}: batch, 3 days, weighing, vaccine, reload, sync, second phone`, async ({ page, browser, context }) => {
    test.setTimeout(180_000);
    const m = messages(locale);
    const t = (ns: string, key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m[ns]) as string);
    const label = (p: Page, ns: string, key: string) => p.getByLabel(t(ns, key), { exact: true });
    const saved = async () => await expect(page.getByRole("status").filter({ hasText: t("Farms", "saved") })).toBeVisible();

    // An owner signs up in this language.
    const phone = randomMobile();
    const e164 = await login(page, locale, phone);
    await label(page, "Onboarding", "nameLabel").fill(`Élevage M1 ${locale}`);
    await page.getByLabel(t("Onboarding", "forms.individual"), { exact: true }).check();
    await page.getByRole("button", { name: t("Onboarding", "submit"), exact: true }).click();
    await page.waitForURL(new RegExp(`/${locale}/dashboard$`));
    await scopeRemembered(page);
    const ids = { farm: crypto.randomUUID(), house: crypto.randomUUID(), supplier: crypto.randomUUID(), feed: crypto.randomUUID(), lot: crypto.randomUUID(), protocol: crypto.randomUUID() };
    await pushAs(page, [
      { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
      { type: "farm-registry.createHouse", payload: { id: ids.house, farmId: ids.farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
      { type: "inventory.createSupplier", payload: { id: ids.supplier, name: "Alf", phone: null } },
      { type: "inventory.createStockItem", payload: { id: ids.feed, farmId: ids.farm, productId: null, kind: "feed", name: "Démarrage", unit: "kg", lot: null, expiresOn: null } },
      { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: ids.supplier, stockItemId: ids.feed, day: farmDaysAgo(5), quantity: 1_000_000, unitPriceCentimes: "450", paidCentimes: "0", dueOn: null } },
      { type: "inventory.createStockItem", payload: { id: ids.lot, farmId: ids.farm, productId: "vaccine-newcastle", kind: "vaccine", name: "Newcastle", unit: "dose", lot: "NDV-26", expiresOn: farmDaysAgo(-365) } },
      { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: crypto.randomUUID(), supplierId: ids.supplier, stockItemId: ids.lot, day: farmDaysAgo(5), quantity: 2000, unitPriceCentimes: "20", paidCentimes: "0", dueOn: null } },
      { type: "reference-data.copyProtocol", payload: { id: ids.protocol, templateId: "broiler-default", name: "Programme" } },
      // Made up for the test, NOT a schedule (OQ4): one vaccine on day 0.
      { type: "reference-data.updateProtocol", payload: { id: ids.protocol, changes: { items: [{ dayOfAge: 0, productId: "vaccine-newcastle", method: "spray" }] } } },
    ]);

    await page.goto(`/${locale}/batches`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await referenceCached(page);
    await expect(label(page, "Batches", "protocol")).toHaveCount(0); // the form isn't open yet
    await page.getByRole("button", { name: t("Batches", "place"), exact: true }).click();
    await expect(label(page, "Batches", "protocol")).toHaveValue(ids.protocol); // pulled before going offline

    // Offline from here.
    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));
    await label(page, "Batches", "placedOn").fill(farmDaysAgo(3));
    await label(page, "Batches", "chicksPlaced").fill("1000");
    await label(page, "Batches", "hatchery").fill("Couvoir Atlas");
    await label(page, "Batches", "deliveryNote").fill("BL-0412");
    await label(page, "Batches", "chickPrice").fill("4,50");
    await page.getByRole("button", { name: t("Batches", "save"), exact: true }).click();
    await page.getByRole("link", { name: t("Day", "open"), exact: true }).click();

    for (const [ago, dead, feedKg] of [[2, "2", "50"], [1, "1", "60"], [0, "1", "70"]] as const) {
      await label(page, "Day", "day").fill(farmDaysAgo(ago));
      await label(page, "Day", "dead").fill(dead);
      await label(page, "Day", "feedKg").fill(feedKg);
      await page.getByRole("button", { name: t("Day", "save"), exact: true }).click();
      await saved();
    }
    const onHand = t("Day", "onHand", { birds: "996" }); // 1 000 − 4
    await expect(page.getByText(onHand)).toBeVisible();

    await label(page, "Weighing", "weights").fill("0,18 0,19 0,20");
    await page.getByRole("button", { name: t("Weighing", "save"), exact: true }).click();
    const weighings = page.getByRole("list", { name: t("Weighing", "past"), exact: true }).getByRole("listitem");
    await expect(weighings).toHaveCount(1);

    const vaccine = page.getByRole("list", { name: t("Vaccination", "title"), exact: true }).getByRole("listitem");
    await vaccine.getByRole("button", { name: t("Vaccination", "markDone"), exact: true }).click();
    await expect(label(page, "Vaccination", "doses")).toHaveValue("996"); // the birds on hand
    await page.getByRole("button", { name: t("Vaccination", "save"), exact: true }).click();
    // The open form's lot list also says NDV-26: wait for it to close (saved) before reloading.
    await expect(label(page, "Vaccination", "doses")).toHaveCount(0);
    await expect(vaccine).toContainText("NDV-26");

    const reload = await page.reload(); // still offline: the shell and the data come from the phone
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(page.getByText(onHand)).toBeVisible();
    await expect(weighings).toHaveCount(1);
    await expect(vaccine).toContainText("NDV-26");

    // Online: everything reaches the server.
    await context.unroute("**");
    await context.setOffline(false);
    const server = async () =>
      (
        await query<{ batch: string; days: number; dead: number; weighings: number; vaccinated: number }>(
          `SELECT b.id AS batch,
                  (SELECT COUNT(*)::int FROM "DailyEntry" d WHERE d."batchId" = b.id) AS days,
                  (SELECT COALESCE(SUM(d.dead), 0)::int FROM "DailyEntry" d WHERE d."batchId" = b.id) AS dead,
                  (SELECT COUNT(*)::int FROM "Weighing" w WHERE w."batchId" = b.id) AS weighings,
                  (SELECT COUNT(*)::int FROM "Vaccination" v WHERE v."batchId" = b.id AND v."doneOn" IS NOT NULL) AS vaccinated
           FROM "Batch" b JOIN "Membership" mb ON mb."organizationId" = b."organizationId" JOIN "User" u ON u.id = mb."userId"
           WHERE u."phoneNumber" = $1`,
          [e164],
        )
      ).map(({ batch, ...rest }) => ({ batch: batch.length, ...rest }));
    await expect.poll(server, { timeout: 30_000 }).toEqual([{ batch: 36, days: 3, dead: 4, weighings: 1, vaccinated: 1 }]);
    const [{ id: batchId }] = await query<{ id: string }>(
      `SELECT b.id FROM "Batch" b JOIN "Membership" mb ON mb."organizationId" = b."organizationId" JOIN "User" u ON u.id = mb."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );

    // A second phone, signed in to the same account, sees it all.
    const second = await browser.newContext({ ...test.info().project.use });
    const other = await second.newPage();
    await login(other, locale, phone);
    await other.waitForURL(new RegExp(`/${locale}/dashboard$`));
    await scopeRemembered(other); // this phone now knows who is signed in, so it syncs
    await other.goto(`/${locale}/batches#${batchId}`);
    await expect(other.getByText(onHand)).toBeVisible({ timeout: 30_000 });
    await expect(other.getByRole("list", { name: t("Weighing", "past"), exact: true }).getByRole("listitem")).toHaveCount(1);
    await expect(other.getByRole("list", { name: t("Vaccination", "title"), exact: true }).getByRole("listitem")).toContainText("NDV-26");
    await second.close();
  });
}
