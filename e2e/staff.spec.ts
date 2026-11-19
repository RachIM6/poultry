import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T70 (SPEC-m4 WF1): an employee added offline on /staff survives a reload and reaches the server once.
// Workers' view without wages is covered by src/modules/workforce/employees.int.test.ts.
test("an employee added offline survives a reload and syncs once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage du Personnel");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/dashboard");

  await page.getByRole("link", { name: "Plus", exact: true }).click();
  await page.getByRole("link", { name: "Personnel" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByRole("button", { name: "Ajouter un ouvrier" })).toBeVisible(); // the farm reached the phone

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Ajouter un ouvrier" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Said A.");
  await page.getByLabel("Salaire par jour (DH)").fill("138,46");
  await page.getByLabel("Logé sur la ferme").check();
  await page.getByLabel("Bâtiment 1").check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const list = page.getByRole("list", { name: "Ouvriers" }).getByRole("listitem");
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText(/Said A\.\s*Ouvrier avicole\s*Bâtiment 1 · 138,46\sDH par jour · logé sur la ferme · sans compte/);

  const reload = await page.reload(); // still offline: the shell and the data come from the phone
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(list).toHaveCount(1);

  await context.unroute("**");
  await context.setOffline(false);
  const server = () =>
    query<{ name: string; wage: string }>(
      `SELECT e.name, e."dailyWageCentimes"::text AS wage FROM "Employee" e
       JOIN "Membership" m ON m."organizationId" = e."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ name: "Said A.", wage: "13846" }]);
});
