import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { controlled, farmDaysAgo, farmWithBatch, login, outboxEmpty, ownerWithFarm, pushAs, query, queuedWrites, randomMobile, scopeRemembered } from "./auth";

// SPEC-m2-compliance §10.2 with a real worker: a visitor, a disposal and a clean-out step recorded offline on the
// worker's phone reach the server once, and stay once after another sync; the worker never opens the vault (DC1).
// Every worker-side label comes from the app's own messages, so the Arabic run checks the Arabic screens.

type Messages = Record<string, Record<string, unknown>>;
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;

for (const locale of ["fr", "ar"] as const) {
  test(`a worker records a visitor, a disposal and a clean-out step offline, each synced once (${locale})`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const m = messages(locale);
    const t = (ns: string, key: string, params: Record<string, string> = {}) =>
      Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m[ns]) as string);

    // The owner: a farm whose only batch closed 3 days ago, its clean-out started, and a worker invited.
    await ownerWithFarm(page, `Élevage des Ouvriers ${locale}`);
    await scopeRemembered(page);
    const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(45));
    await pushAs(page, [
      { type: "flock.closeBatch", payload: { batchId: ids.batch, day: farmDaysAgo(3), reason: "Fin de lot" } },
      { type: "biosecurity.startCleanout", payload: { id: uuidv7(), houseId: ids.house, afterBatchId: ids.batch, startedOn: farmDaysAgo(2) } },
    ]);
    const phone = randomMobile();
    await page.goto("/fr/settings/members");
    await page.getByLabel("Numéro de téléphone").fill(phone);
    await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
    await page.getByRole("button", { name: "Inviter" }).click();
    await expect(page.getByText("Invitation enregistrée.")).toBeVisible();

    // The worker's phone: the three logs are offered, the vault is not.
    const workerContext = await browser.newContext({ ...test.info().project.use });
    const worker = await workerContext.newPage();
    const e164 = await login(worker, locale, phone);
    await expect(worker).toHaveURL(new RegExp(`/${locale}/dashboard$`));
    await scopeRemembered(worker);
    await worker.goto(`/${locale}/more`);
    await expect(worker.getByRole("link", { name: t("Visitors", "open") })).toBeVisible();
    await expect(worker.getByRole("link", { name: t("Disposal", "open") })).toBeVisible();
    await expect(worker.getByRole("link", { name: t("Documents", "open") })).toHaveCount(0);
    await worker.getByRole("link", { name: t("Cleanout", "open") }).click();
    await controlled(worker); // shells precached
    const house = worker.getByRole("region", { name: "Bâtiment 1" });
    const manureOut = t("Cleanout", "steps.manureOut");
    await expect(house.getByRole("button", { name: t("Cleanout", "markNamed", { step: manureOut }) })).toBeVisible(); // the clean-out reached the phone

    // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
    await workerContext.setOffline(true);
    await workerContext.route("**", (route) => route.abort("internetdisconnected"));
    await house.getByRole("button", { name: t("Cleanout", "markNamed", { step: manureOut }) }).click();
    await house.getByRole("button", { name: t("Cleanout", "save") }).click();
    await expect(house.getByRole("button", { name: t("Biosecurity", "editNamed", { record: manureOut }) })).toBeVisible();

    await worker.goto(`/${locale}/visitors`); // precached shell
    await worker.getByLabel(t("Visitors", "visitor"), { exact: true }).fill("Livreur · Provende Atlas");
    await worker.getByLabel(t("Visitors", "purpose"), { exact: true }).selectOption({ label: t("Visitors", "purposes.feedDelivery") });
    await worker.getByLabel(t("Visitors", "footbath"), { exact: true }).check();
    await worker.getByRole("button", { name: t("Visitors", "save") }).click();
    await expect(worker.getByRole("list", { name: t("Visitors", "today") }).getByRole("listitem")).toHaveCount(1);

    await worker.goto(`/${locale}/disposal`);
    await worker.getByLabel(t("Disposal", "birds"), { exact: true }).fill("6");
    await worker.getByLabel(t("Disposal", "method"), { exact: true }).selectOption({ label: t("Disposal", "methods.sealedPit") });
    await worker.getByRole("button", { name: t("Disposal", "save") }).click();
    const disposals = worker.getByRole("list", { name: t("Disposal", "recent") }).getByRole("listitem");
    await expect(disposals).toHaveCount(1);
    await expect.poll(() => queuedWrites(worker)).toBe(3); // all three wait on the phone

    const reload = await worker.reload(); // still offline: the shell and the data come from the phone
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(disposals).toHaveCount(1);

    await workerContext.unroute("**");
    await workerContext.setOffline(false);
    await outboxEmpty(worker);
    const server = () =>
      query<{ visits: number; disposals: number; steps: number }>(
        `SELECT (SELECT count(*)::int FROM "Visit" v WHERE v."recordedBy" = u.id) AS visits,
                (SELECT count(*)::int FROM "Disposal" d WHERE d."recordedBy" = u.id) AS disposals,
                (SELECT count(*)::int FROM "CleanoutStep" s WHERE s."recordedBy" = u.id) AS steps
         FROM "User" u WHERE u."phoneNumber" = $1`,
        [e164],
      );
    await expect.poll(server, { timeout: 15_000 }).toEqual([{ visits: 1, disposals: 1, steps: 1 }]);

    // A second sync sends nothing again, and nothing was refused.
    await worker.goto(`/${locale}/sync`);
    await expect(worker.getByText(t("Sync", "upToDate"))).toBeVisible({ timeout: 30_000 });
    const pulled = worker.waitForResponse((r) => r.url().includes("/api/sync/pull") && r.ok());
    await worker.getByRole("button", { name: t("Sync", "syncNow") }).click();
    await pulled;
    await expect(worker.getByText(t("Sync", "upToDate"))).toBeVisible();
    await expect(worker.getByRole("heading", { name: t("Sync", "attention") })).toHaveCount(0);
    expect(await server()).toEqual([{ visits: 1, disposals: 1, steps: 1 }]);

    // DC1: the vault is for owners and managers.
    await worker.goto(`/${locale}/documents`);
    await expect(worker.getByText(t("Documents", "forbidden"))).toBeVisible();
    await expect(worker.getByRole("button", { name: t("Documents", "add") })).toHaveCount(0);
    await workerContext.close();
  });
}
