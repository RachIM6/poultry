import { expect, test } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";

// T80 (SPEC-m4 CL1, §2): no targets until the owner types them from a source; a version saved offline syncs once.
// The numbers below are made up for the test, NOT husbandry targets (MQ1).
test("the owner enters climate targets from a source, offline, and they sync once", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage du Climat");
  await scopeRemembered(page);

  await page.getByRole("link", { name: "Plus", exact: true }).click();
  await page.getByRole("link", { name: "Cibles de climat" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByRole("note")).toContainText("Aucune cible saisie");

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Saisir les cibles" }).click();
  const form = page.getByRole("form", { name: "Saisir les cibles" });
  await form.getByLabel("Source (document, date, page)").fill("Test E2E, pas une vraie source");
  await form.getByLabel("De J").fill("0");
  await form.getByLabel("À J").fill("7");
  await form.getByLabel("Température min (°C)").fill("10,5");
  await form.getByLabel("Température max (°C)").fill("20");
  await form.getByRole("button", { name: "Enregistrer les cibles" }).click();

  const bands = page.getByRole("list", { name: "Tranches d’âge" }).getByRole("listitem");
  await expect(bands).toHaveText(["J0 à J7 : 10,5 à 20,0 °C · humidité — à — % · ammoniac max — ppm"]);
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(bands).toHaveCount(1);

  await context.unroute("**");
  await context.setOffline(false);
  const server = () =>
    query<{ bands: unknown }>(
      `SELECT t.bands FROM "ClimateTargetSet" t JOIN "Membership" m ON m."organizationId" = t."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ bands: [{ fromAge: 0, toAge: 7, temperatureMinTenths: 105, temperatureMaxTenths: 200, humidityMin: null, humidityMax: null, ammoniaMax: null }] }]);
});
