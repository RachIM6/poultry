import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T86 (SPEC-m4 WF13): a training and a work accident recorded offline on /staff survive a reload and sync once.
test("a training and a work accident recorded offline survive a reload and sync once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Formations");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);
  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] } },
  ]);

  await page.goto("/fr/staff");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const form = page.getByRole("form", { name: "Enregistrer une formation ou un accident" });
  await expect(form).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await form.getByLabel("Thème").selectOption({ label: "Technique de vaccination" });
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await form.getByLabel("Type").selectOption({ label: "Accident du travail" });
  await form.getByLabel("Ce qui s’est passé").fill("Coupure à la main en réparant une mangeoire");
  await form.getByLabel("Jours d’arrêt (si connus)").fill("2");
  await form.getByRole("button", { name: "Enregistrer" }).click();

  const list = page.getByRole("list", { name: "Derniers enregistrements" }).getByRole("listitem");
  await expect(list).toHaveCount(2);
  await expect(list.filter({ hasText: "accident du travail" })).toHaveText(/^Said A\. · accident du travail le .+ : Coupure à la main en réparant une mangeoire\s*Arrêt de travail : 2 j$/);
  await expect(list.filter({ hasText: "formation" })).toHaveText(/^Said A\. · formation : Technique de vaccination · .+$/);
  const reload = await page.reload(); // still offline: kept on the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(list).toHaveCount(2);

  await context.unroute("**");
  await context.setOffline(false);
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
