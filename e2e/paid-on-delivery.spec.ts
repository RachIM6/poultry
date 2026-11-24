import { expect, test } from "@playwright/test";
import { controlled, outboxEmpty, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// SPEC-finance §9 "Chicks paid on delivery": chicks paid in cash at delivery, recorded offline with the placement, leave
// nothing owed on /treasury once synced; the cash box shows the payment.
test("a batch placed offline and paid on delivery leaves nothing to pay on /treasury", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage Livraison");
  await scopeRemembered(page);
  const farm = crypto.randomUUID();
  await pushAs(page, [
    { type: "farm-registry.createFarm", payload: { id: farm, name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } },
    { type: "farm-registry.createHouse", payload: { id: crypto.randomUUID(), farmId: farm, name: "Bâtiment 1", areaM2: 1200, capacity: 12000, type: "closed" } },
    { type: "finance.createTreasuryAccount", payload: { id: crypto.randomUUID(), kind: "cash", name: "Caisse ferme" } },
  ]);

  await page.goto("/fr/batches");
  await controlled(page);
  await referenceCached(page);
  // the cash box reaches the phone with the pull: the form offers the payment once it is there
  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await expect(page.getByLabel("Payé à la livraison")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Mettre en place une bande" }).click();
  await page.getByLabel("Souche").selectOption({ label: "Ross 308" });
  await page.getByLabel("Poussins placés").fill("1000");
  await page.getByLabel("Couvoir").fill("Couvoir Atlas");
  await page.getByLabel("N° de bon de livraison").fill("BL-77");
  await page.getByLabel("Prix d’un poussin (DH)").fill("4,50");
  await page.getByLabel("Payé à la livraison").check();
  await expect(page.getByLabel("Montant payé (DH)")).toHaveValue("4500,00"); // prefilled with the total
  await expect(page.getByLabel("Caisse", { exact: true })).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Jour 0")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  await outboxEmpty(page);
  const paid = () =>
    query<{ amount: string }>(
      `SELECT b."paidOnDeliveryCentimes"::text AS amount FROM "Batch" b
       JOIN "Membership" m ON m."organizationId" = b."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(paid).toEqual([{ amount: "450000" }]);

  await page.goto("/fr/treasury");
  await expect(page.getByText("Paiement fournisseur : Couvoir Atlas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Poussins et poulettes à payer" })).toHaveCount(0);
});
