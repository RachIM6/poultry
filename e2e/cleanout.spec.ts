import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// T42 acceptance (browser part): the clean-out of a house after its closed batch, marked offline step by step; the
// downtime counts from the disinfection; placing the next batch too early warns, never blocks (SPEC-m2-compliance BS4, BS5).
test("clean-out steps are marked offline, the downtime counts, and an early placement warns", async ({ page, context }) => {
  test.setTimeout(150_000);
  const e164 = await ownerWithFarm(page, "Élevage du Vide");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(45));
  await pushAs(page, [
    { type: "flock.closeBatch", payload: { batchId: ids.batch, day: farmDaysAgo(3), reason: "Fin de lot" } },
    { type: "biosecurity.setMinDowntime", payload: { farmId: ids.farm, minDays: 14 } },
  ]);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Nettoyage et vide sanitaire" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  const house = page.getByRole("region", { name: "Bâtiment 1" });
  await expect(house.getByRole("button", { name: "Commencer le nettoyage" })).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await house.getByRole("button", { name: "Commencer le nettoyage" }).click();
  await expect(house.getByRole("status")).toHaveText("Vide sanitaire : commence le jour de la désinfection.");
  await house.getByRole("button", { name: "Noter : Sortie du fumier" }).click();
  await house.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await house.getByRole("button", { name: "Noter : Désinfection" }).click();
  await house.getByLabel("Produit", { exact: true }).fill("Virkon S"); // required: the server refuses a disinfection without it too
  await house.getByRole("button", { name: "Enregistrer l’étape" }).click();
  await expect(house.getByRole("status")).toHaveText(/^Vide sanitaire : jour 1 sur 14 · fin le /);

  await page.goto("/fr/batches"); // precached too
  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await expect(page.getByText("Attention : vide sanitaire de 0 jours dans ce bâtiment, le minimum de la ferme est 14 jours.")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await page.reload();
  const server = async () =>
    await query<{ steps: string[] }>(
      `SELECT array_agg(s.step ORDER BY s.id) AS steps FROM "Cleanout" c JOIN "CleanoutStep" s ON s."cleanoutId" = c.id
       JOIN "Membership" m ON m."organizationId" = c."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ steps: ["manureOut", "disinfection"] }]);
});
