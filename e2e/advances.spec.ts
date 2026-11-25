import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T76 (SPEC-m4 WF10): an advance recorded offline on /staff shows as pending, survives a reload and syncs once.
test("an advance recorded offline is pending, survives a reload and syncs once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Avances");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);
  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { id: crypto.randomUUID(), farmId: ids.farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: farmDaysAgo(30), leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] } },
  ]);

  await page.goto("/fr/staff");
  await controlled(page);
  const form = page.getByRole("form", { name: "Enregistrer une avance" });
  await expect(form).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await form.getByLabel("Montant (DH)").fill("1000");
  await form.getByRole("button", { name: "Enregistrer l’avance" }).click();
  const pending = page.getByRole("list", { name: "Avances en cours" }).getByRole("listitem");
  await expect(pending).toHaveText([/^Said A\. · 1.000,00\sDH le .+ · retenue sur la paie de \p{L}+ \d{4}$/u]);
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(pending).toHaveCount(1);

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ amount: string }>(
      `SELECT a."amountCentimes"::text AS amount FROM "SalaryAdvance" a
       JOIN "Membership" m ON m."organizationId" = a."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ amount: "100000" }]);
});
