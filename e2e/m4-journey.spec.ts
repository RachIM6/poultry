import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, login, ownerWithFarm, pushAs, query, randomMobile, scopeRemembered, inviteCode } from "./auth";

// Checkpoint M4 (SPEC-m4 §9.1): a worker, offline for the day, checks in, ticks a task, records two climate readings
// and a power cut; back online everything reaches the server once, and a second sync adds nothing. The worker's
// labels come from the app's own messages, so the Arabic run checks the Arabic screens. The owner sets up in French.

type Messages = Record<string, Record<string, string>>;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const locale of ["fr", "ar"] as const) {
  test(`M4 offline journey in ${locale}: a worker checks in, ticks a task, records two readings and a power cut, synced once`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages;
    const t = (ns: string, key: string, params: Record<string, string> = {}) => Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), m[ns][key]);
    const arrived = new RegExp(`^${escape(t("Attendance", "arrivedAt", { time: "TIME" })).replace("TIME", "\\d\\d:\\d\\d")}$`);

    await ownerWithFarm(page, `Élevage de la Journée ${locale}`);
    await scopeRemembered(page);
    const ids = await farmWithBatch(page);

    const phone = randomMobile();
    await page.goto("/fr/settings/members");
    await page.getByLabel("Numéro de téléphone").fill(phone);
    await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
    await page.getByRole("button", { name: "Inviter" }).click();
    await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
    const code = await inviteCode(page);
    const workerContext = await browser.newContext({ ...test.info().project.use });
    const worker = await workerContext.newPage();
    const e164 = await login(worker, locale, phone, code);
    await expect(worker).toHaveURL(new RegExp(`/${locale}/dashboard$`));
    await scopeRemembered(worker);

    await pushAs(page, [
      { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [ids.house] } },
      { type: "workforce.saveRoutine", payload: { id: crypto.randomUUID(), farmId: ids.farm, everyDays: 1, startOn: farmDaysAgo(1), fromAge: null, stopOn: null, houseId: ids.house, employeeId: null, title: "Contrôle des abreuvoirs", time: "07:30" } },
    ]);

    // Both screens open once online, so the phone has their shells and data; then the day runs offline.
    const placed = worker.getByText(t("Climate", "age", { day: "0" }));
    await worker.goto(`/${locale}/climate`);
    await expect(placed).toBeVisible();
    await worker.goto(`/${locale}/tasks`);
    await controlled(worker);
    await expect(worker.getByText(t("Tasks", "hello", { name: "Said A." }))).toBeVisible();
    await workerContext.setOffline(true);
    await workerContext.route("**", (route) => route.abort("internetdisconnected"));

    await worker.getByRole("button", { name: t("Attendance", "checkIn") }).click();
    await expect(worker.getByText(arrived)).toBeVisible();
    const tick = worker.getByRole("button", { name: t("Tasks", "tick", { task: "Contrôle des abreuvoirs · Bâtiment 1" }) });
    await tick.click();
    await expect(tick).toHaveAttribute("aria-pressed", "true");

    await worker.goto(`/${locale}/climate`);
    await expect(placed).toBeVisible();
    const form = worker.getByRole("form", { name: t("Climate", "reading") });
    const temperature = form.getByLabel(t("Climate", "temperature"));
    for (const [celsius, humidity] of [["24,5", "68"], ["26", "64"]]) {
      await temperature.fill(celsius);
      await form.getByLabel(t("Climate", "humidity")).fill(humidity);
      await form.getByRole("button", { name: t("Climate", "save") }).click();
      await expect(temperature).toHaveValue(""); // saved on the phone, the form is cleared
    }
    const startCut = worker.getByRole("button", { name: t("Climate", "cutStart"), exact: true });
    await startCut.click();
    const open = worker.getByRole("form", { name: t("Climate", "cutEnd") });
    await open.getByLabel(t("Climate", "generatorStarted")).check();
    await open.getByRole("button", { name: t("Climate", "cutEnd") }).click();
    await expect(startCut).toBeVisible();

    const reload = await worker.reload(); // still offline: everything is kept on the phone
    expect(reload?.fromServiceWorker()).toBe(true);
    await expect(worker.getByRole("list", { name: t("Climate", "lastReadings") }).getByRole("listitem")).toHaveCount(2);

    await workerContext.unroute("**");
    await workerContext.setOffline(false);
    const server = () =>
      query<{ attendance: number; done: number; readings: number; cuts: number }>(
        `WITH w AS (SELECT id FROM "User" WHERE "phoneNumber" = $1)
         SELECT (SELECT count(*)::int FROM "Attendance" WHERE "userId" = (SELECT id FROM w) AND status = 'present') AS attendance,
                (SELECT count(*)::int FROM "TaskDone" WHERE "byUserId" = (SELECT id FROM w)) AS done,
                (SELECT count(*)::int FROM "ClimateReading" WHERE "byUserId" = (SELECT id FROM w)) AS readings,
                (SELECT count(*)::int FROM "PowerCut" WHERE "byUserId" = (SELECT id FROM w) AND "endedAt" IS NOT NULL) AS cuts`,
        [e164],
      );
    const once = { attendance: 1, done: 1, readings: 2, cuts: 1 };
    await expect.poll(server, { timeout: 60_000 }).toEqual([once]);

    await worker.reload(); // online again: a second sync must not duplicate anything
    await worker.goto(`/${locale}/tasks`);
    await expect(worker.getByText(arrived)).toBeVisible();
    expect(await server()).toEqual([once]);
    await workerContext.close();
  });
}
