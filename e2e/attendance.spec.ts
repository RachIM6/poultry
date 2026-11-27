import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, login, ownerWithFarm, pushAs, randomMobile, scopeRemembered, inviteCode } from "./auth";

// T75 (SPEC-m4 WF9): the worker checks in offline on /tasks; after sync the owner sees "P" today in the /staff grid.
test("a worker checks in offline and the owner sees them present after sync", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage de la Présence");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);

  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByRole("button", { name: "Inviter un membre" }).click(); // the invite form is in a sheet
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  const code = await inviteCode(page);
  const workerContext = await browser.newContext({ ...test.info().project.use });
  const worker = await workerContext.newPage();
  await login(worker, "fr", phone, code);
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);
  await scopeRemembered(worker);

  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [ids.house] } },
  ]);

  await worker.goto("/fr/tasks");
  await controlled(worker);
  await expect(worker.getByText("Bonjour Said A.")).toBeVisible();
  await workerContext.setOffline(true);
  await workerContext.route("**", (route) => route.abort("internetdisconnected"));
  await worker.getByRole("button", { name: "Je suis arrivé" }).click();
  await expect(worker.getByText(/^Arrivé à \d\d:\d\d$/)).toBeVisible();
  await worker.reload(); // offline: kept on the phone
  await expect(worker.getByText(/^Arrivé à \d\d:\d\d$/)).toBeVisible();
  await workerContext.unroute("**");
  await workerContext.setOffline(false);

  await page.goto("/fr/staff?tab=presence");
  const today = Number(farmDaysAgo(0).slice(8));
  const row = page.getByRole("region", { name: "Présence" }).getByRole("row", { name: /Said A\./ });
  await expect(async () => {
    await page.reload(); // until the check-in has reached the server and this phone
    await expect(row.getByRole("cell").nth(today - 1)).toHaveText("P", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await workerContext.close();
});
