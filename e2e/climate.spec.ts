import { expect, test } from "@playwright/test";
import { farmWithBatch, outboxEmpty, ownerWithFarm, query, scopeRemembered } from "./auth";

// T81 (SPEC-m4 CL2, CL3): a reading recorded offline, with no targets entered, says so and syncs once.
test("a climate reading recorded offline without targets says so, survives a reload and syncs once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Relevés");
  await scopeRemembered(page);
  await farmWithBatch(page);
  await page.goto("/fr/dashboard");

  await page.getByRole("link", { name: "Plus", exact: true }).click();
  await page.getByRole("link", { name: "Climat des bâtiments" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByText("Lot en place : J0")).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const form = page.getByRole("form", { name: "Relevé de climat" });
  await form.getByLabel("Température (°C)").fill("24,5");
  await form.getByLabel("Humidité (%)").fill("68");
  await expect(form.getByText("aucune cible saisie").first()).toBeVisible();
  await form.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await expect(page.getByRole("status")).toHaveText(/^Enregistré sur ce téléphone/);
  await expect(page.getByText(/Hors des cibles/)).toHaveCount(0); // no target, no verdict
  const reload = await page.reload(); // still offline: kept on the phone, in the outbox
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Lot en place : J0")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const server = () =>
    query<{ t: number; h: number }>(
      `SELECT r."temperatureTenths" AS t, r.humidity AS h FROM "ClimateReading" r
       JOIN "Membership" m ON m."organizationId" = r."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ t: 245, h: 68 }]);
});
