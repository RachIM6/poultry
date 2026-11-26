import { expect, test } from "@playwright/test";
import { controlled, outboxEmpty, ownerWithFarm, query, scopeRemembered } from "./auth";

// T11 acceptance: reference data is on the phone after the first sync; the organisation copies the template and edits
// its copy offline; the template stays as it was. Needs `pnpm db:seed` (CI runs it).
test("the vaccination template is available offline, and a farm's copy is edited offline then synced", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage Référence");
  await scopeRemembered(page);
  await page.goto("/fr/protocol");
  await controlled(page); // shells precached
  await expect(page.getByText("Programme de vaccination poulet de chair")).toBeVisible(); // reference data cached
  // one template per type (SPEC-m3 R9), in one list; what they all share (not checked by a vet, no vaccine) said once
  const broiler = page.getByRole("list", { name: "Modèles de référence" }).getByRole("listitem").filter({ hasText: "Programme de vaccination poulet de chair" });
  await expect(page.getByText(/Pas encore vérifiés par un vétérinaire/)).toHaveCount(1);
  await expect(page.getByText(/Ces modèles ne contiennent encore aucun vaccin/)).toBeVisible();
  await expect(page.getByText("Programme de vaccination pondeuse")).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Programme de vaccination poulet de chair")).toBeVisible(); // from IndexedDB

  await broiler.getByRole("button", { name: "Copier pour mon exploitation" }).click();
  await page.getByRole("button", { name: /^Ajouter un vaccin/ }).click(); // its sheet
  await page.getByLabel("Âge (jours)").fill("14");
  await page.getByLabel("Vaccin", { exact: true }).selectOption({ label: "Vaccin Gumboro" });
  await page.getByLabel("Mode d’administration").selectOption({ label: "Eau de boisson" });
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const line = page.getByRole("table", { name: "Programme de vaccination poulet de chair" }).getByRole("row").nth(1);
  await expect(line).toHaveText(/^14\s*Vaccin Gumboro\s*Eau de boisson\s*Retirer$/);
  await expect(line.getByRole("button", { name: "Retirer : Jour 14 · Vaccin Gumboro · Eau de boisson" })).toBeVisible();
  // OQ4: no Newcastle line yet, a warning citing the arrêté, not a block
  await expect(page.getByText(/Aucune vaccination contre la maladie de Newcastle dans ce programme.*Arrêté n° 3308-17, art\. 13/)).toBeVisible();

  await page.reload();
  await expect(line).toHaveText(/^14\s*Vaccin Gumboro\s*Eau de boisson/);

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
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
