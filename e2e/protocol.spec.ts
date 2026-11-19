import { expect, test } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";

// T11 acceptance: reference data is on the phone after the first sync; the organisation copies the template and edits
// its copy offline; the template stays as it was. Needs `pnpm db:seed` (CI runs it).
test("the vaccination template is available offline, and a farm's copy is edited offline then synced", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage Référence");
  await scopeRemembered(page);
  await page.goto("/fr/protocol");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect(page.getByText("Programme de vaccination poulet de chair")).toBeVisible(); // reference data cached
  await expect(page.getByText(/Pas encore vérifié par un vétérinaire/)).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Programme de vaccination poulet de chair")).toBeVisible(); // from IndexedDB

  await page.getByRole("button", { name: "Copier pour mon exploitation" }).click();
  await page.getByRole("button", { name: "Ajouter un vaccin" }).click();
  await page.getByLabel("Âge (jours)").fill("14");
  await page.getByLabel("Vaccin", { exact: true }).selectOption({ label: "Vaccin Gumboro" });
  await page.getByLabel("Mode d’administration").selectOption({ label: "Eau de boisson" });
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Jour 14 · Vaccin Gumboro · Eau de boisson")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Jour 14 · Vaccin Gumboro · Eau de boisson")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const items = async () =>
    (
      await query<{ items: unknown }>(
        `SELECT p.items FROM "VaccinationProtocol" p JOIN "Membership" m ON m."organizationId" = p."organizationId"
         JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
        [e164],
      )
    )[0]?.items;
  await expect.poll(items).toEqual([{ dayOfAge: 14, productId: "vaccine-gumboro", method: "drinkingWater" }]);
  const [template] = await query<{ items: unknown }>(`SELECT items FROM "ProtocolTemplate" WHERE id = 'broiler-default'`, []);
  expect(template.items).toEqual([]); // the global template is untouched
});
