import { expect, test } from "@playwright/test";
import { controlled, outboxEmpty, ownerWithFarm, query, referenceCached, scopeRemembered } from "./auth";

// T15 acceptance: a batch placed offline counts its age from the placement day; a second open batch in the same house
// is refused with a clear message (the two-phones case is tested on the server: src/modules/flock/batches.int.test.ts).
test("a batch placed offline starts at day 0, and a second one in the same house is refused", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage des Bandes");
  await scopeRemembered(page);

  await page.goto("/fr/farms");
  await page.getByRole("button", { name: "Ajouter une ferme" }).click();
  await page.getByLabel("Nom de la ferme").fill("Ferme Atlas");
  await page.getByLabel("Région").fill("Casablanca-Settat");
  await page.getByLabel("Province").fill("Settat");
  await page.getByLabel("Commune").fill("Ben Ahmed");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByRole("button", { name: "Ajouter un bâtiment" }).click();
  await page.getByLabel("Nom du bâtiment").fill("Bâtiment 1");
  await page.getByLabel("Surface (m²)").fill("1200");
  await page.getByLabel("Capacité (oiseaux)").fill("12000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Bâtiment 1")).toBeVisible();

  await page.goto("/fr/batches");
  await controlled(page);
  await expect(page.getByText("Aucune bande pour l’instant.")).toBeVisible();
  await referenceCached(page); // the strains come with it
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const place = async () => {
    await page.getByRole("button", { name: "Mettre en place une bande" }).click();
    await page.getByLabel("Souche").selectOption({ label: "Ross 308" });
    await page.getByLabel("Poussins placés").fill("12000");
    await page.getByLabel("Morts à l’arrivée").fill("36");
    await page.getByLabel("Couvoir").fill("Couvoir Atlas");
    await page.getByLabel("N° de bon de livraison").fill("BL-0412");
    await page.getByLabel("Prix d’un poussin (DH)").fill("4,50");
    await page.getByRole("button", { name: "Enregistrer" }).click();
  };
  await place();
  await expect(page.getByText("Jour 0")).toBeVisible();
  await expect(page.getByText("Poulet de chair · Ferme Atlas · Bâtiment 1 · Ross 308")).toBeVisible();

  // SPEC-m3 R5: the production type first, then only its strains.
  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await page.getByLabel("Production").selectOption({ label: "Pondeuse" });
  await expect(page.getByLabel("Souche").locator("option")).toHaveText(["Lohmann Brown", "Souche non précisée"]);
  await page.getByRole("button", { name: "Annuler" }).click();

  await place();
  await expect(page.getByRole("alert").filter({ hasText: "Ce bâtiment a déjà une bande en cours" })).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText("Jour 0")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const batches = async () =>
    await query<{ status: string; price: string; chicks: number }>(
      `SELECT b.status, b."chickUnitPriceCentimes"::text AS price, b."chicksPlaced" AS chicks FROM "Batch" b
       JOIN "Membership" m ON m."organizationId" = b."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(batches).toEqual([{ status: "open", price: "450", chicks: 12_000 }]);
});
