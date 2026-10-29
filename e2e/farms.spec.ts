import { expect, test } from "@playwright/test";
import { login, ownerWithFarm, query, scopeRemembered } from "./auth";

// T10 acceptance: a farm and 2 houses created offline survive a reload, then sync; a second phone sees them.
test("a farm and two houses created offline survive a reload, sync, and reach a second phone", async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Exploitation Atlas");
  await scopeRemembered(page);
  await page.goto("/fr/farms");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect(page.getByText("Aucune ferme pour l’instant.")).toBeVisible();

  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Ajouter une ferme" }).click();
  await page.getByLabel("Nom de la ferme").fill("Ferme du Plateau");
  await page.getByLabel("Région").fill("Casablanca-Settat");
  await page.getByLabel("Province").fill("Settat");
  await page.getByLabel("Commune").fill("Ben Ahmed");
  await page.getByLabel("Numéro d’autorisation").fill("ONSSA/26/0412");
  await page.getByLabel("Valable jusqu’au").fill("2027-03-31");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Ferme du Plateau" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Enregistré sur ce téléphone. L’envoi se fait dès qu’il y a du réseau.");

  for (const [name, type] of [["Bâtiment 1", "closed"], ["Bâtiment 2", "open"]]) {
    await page.getByRole("button", { name: "Ajouter un bâtiment" }).click();
    await page.getByLabel("Nom du bâtiment").fill(name);
    await page.getByLabel("Surface (m²)").fill("1200");
    await page.getByLabel("Capacité (oiseaux)").fill("12000");
    await page.getByLabel("Type").selectOption(type);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(name)).toBeVisible();
  }

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true); // the static shell, from the precache
  await expect(page.getByRole("heading", { name: "Ferme du Plateau" })).toBeVisible();
  await expect(page.getByText(/m² · .* oiseaux · Fermé/)).toBeVisible();
  await expect(page.getByText(/m² · .* oiseaux · Ouvert/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false); // the "online" event starts a sync
  const housesOnServer = async () =>
    (
      await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "House" h JOIN "Membership" m ON m."organizationId" = h."organizationId"
         JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
        [e164],
      )
    )[0].n;
  await expect.poll(housesOnServer).toBe(2);

  // The owner's second phone: same account, empty phone database, gets everything on its first pull.
  const otherPhone = await browser.newContext({ ...test.info().project.use });
  const second = await otherPhone.newPage();
  await login(second, "fr", `0${e164.slice(4)}`);
  await expect(second).toHaveURL(/\/fr\/dashboard$/);
  await scopeRemembered(second);
  await second.getByRole("link", { name: "Fermes et bâtiments" }).click();
  await second.getByRole("link", { name: /Ferme du Plateau/ }).click();
  await expect(second.getByText("Bâtiment 1")).toBeVisible();
  await expect(second.getByText("Bâtiment 2")).toBeVisible();
  await expect(second.getByText(/ONSSA\/26\/0412/)).toBeVisible();
  await otherPhone.close();
});
