import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, login, ownerWithFarm, pushAs, query, randomMobile, scopeRemembered } from "./auth";

// T73 (SPEC-m4 WF6, WF8): a worker linked to an employee sees only their tasks, ticks one offline, and it syncs once.
test("a worker sees their own tasks, ticks one offline, and the tick reaches the server once", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage de Said");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);

  // The owner invites the worker, who signs in once (the invitation becomes a membership).
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

  // Said looks after Bâtiment 1; the guard's round is Hamid's.
  const [said, hamid] = [crypto.randomUUID(), crypto.randomUUID()];
  const employee = { farmId: ids.farm, job: "worker", housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null };
  const routine = { farmId: ids.farm, everyDays: 1, startOn: farmDaysAgo(1), fromAge: null, stopOn: null };
  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { ...employee, id: said, name: "Said A.", phone, houseIds: [ids.house] } },
    { type: "workforce.createEmployee", payload: { ...employee, id: hamid, name: "Hamid M.", phone: null, houseIds: [] } },
    { type: "workforce.saveRoutine", payload: { ...routine, id: crypto.randomUUID(), houseId: ids.house, employeeId: null, title: "Contrôle des abreuvoirs", time: "07:30" } },
    { type: "workforce.saveRoutine", payload: { ...routine, id: crypto.randomUUID(), houseId: null, employeeId: hamid, title: "Ronde du gardien", time: "22:00" } },
  ]);

  await worker.goto("/fr/tasks");
  await worker.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(worker.getByText("Bonjour Said A.")).toBeVisible();
  const list = worker.getByRole("list", { name: "Tâches d’aujourd’hui" }).getByRole("listitem");
  await expect(list).toHaveText([/Saisie du jour · Bâtiment 1/, /07:30\s*Contrôle des abreuvoirs · Bâtiment 1/]); // not Hamid's round
  const progress = worker.getByRole("region", { name: "Avancement du jour" });
  await expect(progress).toContainText("0 faites sur 2");

  await workerContext.setOffline(true);
  await workerContext.route("**", (route) => route.abort("internetdisconnected"));
  const tick = worker.getByRole("button", { name: "Faite : Contrôle des abreuvoirs · Bâtiment 1" });
  await tick.click();
  await expect(tick).toHaveAttribute("aria-pressed", "true");
  await expect(progress).toContainText("1 faites sur 2");
  const reload = await worker.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(progress).toContainText("1 faites sur 2");

  await workerContext.unroute("**");
  await workerContext.setOffline(false);
  const server = () => query<{ n: number }>(`SELECT count(*)::int AS n FROM "TaskDone" d JOIN "User" u ON u.id = d."byUserId" WHERE u."phoneNumber" = $1`, [e164]);
  await expect.poll(server).toEqual([{ n: 1 }]);
  await workerContext.close();
});
