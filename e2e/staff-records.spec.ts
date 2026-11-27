import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T86 (SPEC-m4 WF13): a training and a work accident recorded offline on /staff survive a reload and sync once.
// Labels come from the app's messages, so the Arabic run checks the Arabic screen; the owner signs up in French.

type Messages = Record<string, Record<string, unknown>>;

for (const locale of ["fr", "ar"] as const) {
  test(`a training and a work accident recorded offline in ${locale} survive a reload and sync once`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;
    const t = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m) as string;
    const e164 = await ownerWithFarm(page, `Élevage des Formations ${locale}`);
    await scopeRemembered(page);
    const ids = await farmWithBatch(page);
    await pushAs(page, [
      { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] } },
    ]);

    await page.goto(`/${locale}/staff?tab=records`);
    await controlled(page);
    const add = page.getByRole("button", { name: t("Records.add") }); // the form opens in a sheet
    const form = page.getByRole("form", { name: t("Records.add") });
    await expect(add).toBeVisible();

    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));
    await add.click();
    await form.getByLabel(t("Records.topic")).selectOption({ label: t("Records.topics.vaccination") });
    await form.getByRole("button", { name: t("Records.save"), exact: true }).click();
    const list = page.getByRole("list", { name: t("Records.list") }).getByRole("listitem");
    await expect(list).toHaveCount(1); // saved, and the sheet closed
    await expect(form).toHaveCount(0);
    await add.click();
    await form.getByLabel(t("Records.kind")).selectOption({ label: t("Records.kinds.accident") });
    await form.getByLabel(t("Records.what")).fill("Coupure à la main en réparant une mangeoire");
    await form.getByLabel(t("Records.daysOff")).fill("2");
    await form.getByRole("button", { name: t("Records.save"), exact: true }).click();

    await expect(list).toHaveCount(2);
    const accident = list.filter({ hasText: "Coupure à la main" });
    await expect(accident).toContainText(t("Records.daysOffLine").replace("{days}", "2"));
    await expect(list.filter({ hasNotText: "Coupure à la main" })).toContainText(t("Records.topics.vaccination"));
    const reload = await page.reload(); // still offline: kept on the phone
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(list).toHaveCount(2);

    await context.unroute("**");
    await context.setOffline(false);
    await outboxEmpty(page);
    const server = () =>
      query<{ kind: string; topic: string | null; daysOff: number | null }>(
        `SELECT r.kind, r.topic, r."daysOff" FROM "StaffRecord" r
         JOIN "Membership" m ON m."organizationId" = r."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 ORDER BY r.kind`,
        [e164],
      );
    await expect.poll(server).toEqual([
      { kind: "accident", topic: null, daysOff: 2 },
      { kind: "training", topic: "vaccination", daysOff: null },
    ]);
  });
}
