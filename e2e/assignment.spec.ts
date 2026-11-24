import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T74 (SPEC-m4 WF7): the owner gives today's entry to another employee offline; it syncs once. Who sees it on their
// phone afterwards is the domain rule (workforce/domain/tasks.test.ts) the worker's screen runs (e2e/my-tasks.spec.ts).
test("a task given to another employee offline shows their name and reaches the server once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Équipes");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);
  const employee = { farmId: ids.farm, job: "worker", phone: null, housedOnFarm: false, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null };
  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { ...employee, id: crypto.randomUUID(), name: "Said A.", houseIds: [ids.house] } },
    { type: "workforce.createEmployee", payload: { ...employee, id: crypto.randomUUID(), name: "Hamid M.", houseIds: [] } },
  ]);

  await page.goto("/fr/tasks");
  await controlled(page);
  const entry = page.getByRole("list", { name: "Tâches d’aujourd’hui" }).getByRole("listitem").first();
  await expect(entry).toContainText("Pour : Said A."); // he looks after Bâtiment 1

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Confier « Saisie du jour · Bâtiment 1 » à").selectOption({ label: "Hamid M." });
  await expect(entry).toContainText("Pour : Hamid M.");
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(entry).toContainText("Pour : Hamid M.");

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ name: string }>(
      `SELECT e.name FROM "TaskAssignment" t JOIN "Employee" e ON e.id = t."employeeId"
       JOIN "Membership" m ON m."organizationId" = t."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ name: "Hamid M." }]);
});
