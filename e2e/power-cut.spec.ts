import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, query, scopeRemembered } from "./auth";

// T83 (SPEC-m4 CL5): a power cut started and ended offline, with the generator's details, reaches the server once.
test("a power cut started and ended offline syncs once with the generator's details", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage du Groupe");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/climate");
  await expect(page.getByText("Lot en place : J0")).toBeVisible(); // the farm reached the phone
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Coupure de courant" }).click();
  const open = page.getByRole("form", { name: "Courant revenu" });
  await expect(open.getByText(/^Coupure de courant depuis \d\d:\d\d$/)).toBeVisible();
  await page.reload();
  await open.getByLabel("Le groupe électrogène a démarré").check();
  await open.getByLabel("Temps de démarrage du groupe (secondes, facultatif)").fill("40");
  await open.getByLabel("Gasoil utilisé (litres, facultatif)").fill("18,5");
  await open.getByRole("button", { name: "Courant revenu" }).click();
  await expect(page.getByRole("button", { name: "Coupure de courant" })).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const server = () =>
    query<{ ended: boolean; seconds: number; ml: number }>(
      `SELECT c."endedAt" IS NOT NULL AS ended, c."generatorSeconds" AS seconds, c."dieselMl" AS ml FROM "PowerCut" c
       JOIN "Membership" m ON m."organizationId" = c."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ ended: true, seconds: 40, ml: 18_500 }]);
});
