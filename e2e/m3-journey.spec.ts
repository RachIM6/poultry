import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { batchTab, controlled, farmDaysAgo, login, pushAs, query, randomMobile, referenceCached, scopeRemembered } from "./auth";

// T68, SPEC-m3 §6.1: the layer farm's journey, offline, in each language on a phone: pullets → transfer to the laying
// house → a collection → grading → an egg sale by the tray → old hens sold by the head → reload → online → synced.
// Every label comes from the app's own messages, so the Arabic run checks the Arabic screens.

type Messages = Record<string, Record<string, unknown>>;
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;

for (const locale of ["fr", "ar"] as const) {
  test(`M3 layer journey in ${locale}: transfer, collection, grading, egg sale, old hens, offline`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const m = messages(locale);
    const t = (ns: string, key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m[ns]) as string);
    const label = (p: Page, ns: string, key: string, params?: Record<string, string>) => p.getByLabel(t(ns, key, params), { exact: true });
    const button = (ns: string, key: string) => page.getByRole("button", { name: t(ns, key), exact: true });

    const e164 = await login(page, locale, randomMobile());
    await label(page, "Onboarding", "nameLabel").fill(`Élevage M3 ${locale}`);
    await page.getByLabel(t("Onboarding", "forms.individual"), { exact: true }).check();
    await page.getByRole("button", { name: t("Onboarding", "submit"), exact: true }).click();
    await page.waitForURL(new RegExp(`/${locale}/dashboard$`));
    await scopeRemembered(page);
    const ids = { farm: crypto.randomUUID(), rearing: crypto.randomUUID(), laying: crypto.randomUUID(), pullets: crypto.randomUUID(), buyer: crypto.randomUUID() };
    await pushAs(page, [
      { type: "farm-registry.createFarm", payload: { id: ids.farm, name: "Ferme Sidi Hajjaj", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
      { type: "farm-registry.createHouse", payload: { id: ids.rearing, farmId: ids.farm, name: "P2", areaM2: 800, capacity: 5000, type: "closed" } },
      { type: "farm-registry.createHouse", payload: { id: ids.laying, farmId: ids.farm, name: "P1", areaM2: 1000, capacity: 6000, type: "closed" } },
      { type: "sales.createBuyer", payload: { id: ids.buyer, name: "Grossiste Al Wafa", phone: null, type: "trader" } },
      {
        type: "flock.placeBatch",
        payload: { id: ids.pullets, houseId: ids.rearing, species: "pullet", strainId: "lohmann-brown", placedOn: farmDaysAgo(2), chicksPlaced: 4800, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "700", dayOldWeightGrams: null, ageAtPlacementDays: 119 },
      },
    ]);

    await page.goto(`/${locale}/batches`);
    await controlled(page);
    await referenceCached(page);
    await expect(page.getByRole("link", { name: t("Day", "open"), exact: true })).toBeVisible();
    await page.goto(`/${locale}/eggs`); // both shells visited once online
    await page.goto(`/${locale}/batches`);

    // Offline from here.
    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));

    // 1. Transfer to the laying house.
    await page.getByRole("link", { name: t("Day", "open"), exact: true }).click();
    await batchTab(page, t("Batches", "tabs.gestion"));
    await button("Transfer", "title").click();
    await label(page, "Transfer", "house").selectOption({ label: "Ferme Sidi Hajjaj · P1" });
    await label(page, "Transfer", "hens").fill("4700");
    await button("Transfer", "save").click();
    await page.getByRole("link", { name: t("Day", "back"), exact: true }).click();

    // 2. A collection on the layer batch (P-EggCollect's: 1 713 eggs).
    await page.getByRole("link", { name: t("Day", "open"), exact: true }).click();
    for (const [k, n] of [["normal", "1642"], ["cracked", "18"], ["dirty", "31"], ["doubleYolk", "6"], ["floor", "12"], ["broken", "4"]]) await label(page, "Eggs", `categories.${k}`).fill(n);
    await button("Eggs", "save").click();
    await expect(page.getByText(new RegExp(t("Eggs", "line", { n: "1", eggs: "1.713", down: "65" }).replace(/[()]/g, "\\$&")))).toBeVisible();

    // 3. Old hens sold by the head (P-Beldi's form on the layer batch).
    await batchTab(page, t("Batches", "tabs.ventes"));
    await button("Sale", "add").click();
    await label(page, "Sale", "perHead").check();
    await label(page, "Sale", "heads.bird").fill("100");
    await label(page, "Sale", "pricePerHead", { what: t("Sale", "heads.bird") }).fill("25");
    await label(page, "Sale", "paid").fill("2500");
    await button("Sale", "save").click();
    await expect(page.getByText(new RegExp(t("Day", "onHand", { birds: "4.600" }))).first()).toBeVisible(); // 4 700 − 100

    // 4. Grading and an egg sale on /eggs.
    await page.goto(`/${locale}/eggs`);
    const ungraded = page.getByRole("row").filter({ hasText: t("EggStock", "items.ungraded") });
    await ungraded.getByRole("button", { name: t("EggStock", "grade"), exact: true }).click();
    const sheet = page.getByRole("dialog"); // the grading opens in a sheet
    await sheet.getByLabel(t("EggStock", "gradeCount", { grade: "M" }), { exact: true }).fill("1500");
    await sheet.getByRole("button", { name: t("EggStock", "saveGrading"), exact: true }).click();
    await button("EggSale", "open").click();
    await page.getByRole("combobox", { name: t("EggSale", "item"), exact: true }).selectOption({ label: "M" });
    await label(page, "EggSale", "trays").fill("30");
    await label(page, "EggSale", "price").fill("33");
    await page.getByRole("combobox", { name: t("Sale", "method"), exact: true }).selectOption({ label: t("Sale", "methods.credit") });
    await button("EggSale", "save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0); // the sheet closed: saved

    const reload = await page.reload(); // still offline
    expect(reload?.fromServiceWorker()).toBe(true);

    // Online: everything reaches the server.
    await context.unroute("**");
    await context.setOffline(false);
    const server = async () =>
      (
        await query<{ pullets: string; layers: number; eggs: number; graded: number; eggSale: string | null; headSale: string | null }>(
          `SELECT (SELECT status FROM "Batch" b WHERE b.id = $2) AS pullets,
                  (SELECT count(*)::int FROM "Batch" b WHERE b."organizationId" = m."organizationId" AND b.species = 'layer' AND b."fromBatchId" = $2) AS layers,
                  (SELECT sum(normal + cracked + dirty + "doubleYolk" + floor + broken)::int FROM "EggCollection" c WHERE c."organizationId" = m."organizationId") AS eggs,
                  (SELECT count(*)::int FROM "EggGrading" g WHERE g."organizationId" = m."organizationId") AS graded,
                  (SELECT "amountCentimes"::text FROM "Sale" s WHERE s."organizationId" = m."organizationId" AND s.kind = 'eggs') AS "eggSale",
                  (SELECT "amountCentimes"::text FROM "Sale" s WHERE s."organizationId" = m."organizationId" AND s.kind = 'perHead') AS "headSale"
           FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
          [e164, ids.pullets],
        )
      )[0];
    // 900 eggs of M at 33,00 a tray of 30 = 990,00 DH; 100 hens × 25,00 = 2 500,00 DH.
    await expect.poll(server, { timeout: 30_000 }).toEqual({ pullets: "closed", layers: 1, eggs: 1713, graded: 1, eggSale: "99000", headSale: "250000" });
  });
}
