import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, login, ownerWithFarm, pushAs, query, randomMobile, scopeRemembered } from "./auth";

// Checkpoint M4 (SPEC-m4 §9.1): a worker, offline for the day, checks in, ticks a task, records two climate readings
// and a power cut; back online everything reaches the server once, and a second sync adds nothing.
test("M4 offline journey: a worker checks in, ticks a task, records two readings and a power cut, synced once", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await ownerWithFarm(page, "Élevage de la Journée");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);

  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  const workerContext = await browser.newContext({ ...test.info().project.use });
  const worker = await workerContext.newPage();
  const e164 = await login(worker, "fr", phone);
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);
  await scopeRemembered(worker);

  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [ids.house] } },
    { type: "workforce.saveRoutine", payload: { id: crypto.randomUUID(), farmId: ids.farm, everyDays: 1, startOn: farmDaysAgo(1), fromAge: null, stopOn: null, houseId: ids.house, employeeId: null, title: "Contrôle des abreuvoirs", time: "07:30" } },
  ]);

  // Both screens open once online, so the phone has their shells and data; then the day runs offline.
  await worker.goto("/fr/climate");
  await expect(worker.getByText("Lot en place : J0")).toBeVisible();
  await worker.goto("/fr/tasks");
  await worker.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(worker.getByText("Bonjour Said A.")).toBeVisible();
  await workerContext.setOffline(true);
  await workerContext.route("**", (route) => route.abort("internetdisconnected"));

  await worker.getByRole("button", { name: "Je suis arrivé" }).click();
  await expect(worker.getByText(/^Arrivé à \d\d:\d\d$/)).toBeVisible();
  const tick = worker.getByRole("button", { name: "Faite : Contrôle des abreuvoirs · Bâtiment 1" });
  await tick.click();
  await expect(tick).toHaveAttribute("aria-pressed", "true");

  await worker.goto("/fr/climate");
  await expect(worker.getByText("Lot en place : J0")).toBeVisible();
  const form = worker.getByRole("form", { name: "Relevé de climat" });
  for (const [temperature, humidity] of [["24,5", "68"], ["26", "64"]]) {
    await form.getByLabel("Température (°C)").fill(temperature);
    await form.getByLabel("Humidité (%)").fill(humidity);
    await form.getByRole("button", { name: "Enregistrer le relevé" }).click();
    await expect(form.getByLabel("Température (°C)")).toHaveValue(""); // saved on the phone, the form is cleared
  }
  await worker.getByRole("button", { name: "Coupure de courant" }).click();
  const open = worker.getByRole("form", { name: "Courant revenu" });
  await open.getByLabel("Le groupe électrogène a démarré").check();
  await open.getByRole("button", { name: "Courant revenu" }).click();
  await expect(worker.getByRole("button", { name: "Coupure de courant" })).toBeVisible();

  const reload = await worker.reload(); // still offline: everything is kept on the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(worker.getByRole("list", { name: "Derniers relevés" }).getByRole("listitem")).toHaveCount(2);

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
  await worker.goto("/fr/tasks");
  await expect(worker.getByText(/^Arrivé à \d\d:\d\d$/)).toBeVisible();
  expect(await server()).toEqual([once]);
  await workerContext.close();
});
