import { expect, test } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";

// T13 acceptance: a purchase made offline increases stock and, after sync, the unpaid part is supplier credit.
test("an offline feed purchase shows in stock and in the supplier's balance, then syncs exactly", async ({ page, context }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage du Stock");
  await scopeRemembered(page);

  // A farm first (online), then the stock screen, so its shell is precached.
  await page.goto("/fr/farms");
  await page.getByRole("button", { name: "Ajouter une ferme" }).click();
  await page.getByLabel("Nom de la ferme").fill("Ferme Stock");
  await page.getByLabel("Région").fill("Casablanca-Settat");
  await page.getByLabel("Province").fill("Settat");
  await page.getByLabel("Commune").fill("Ben Ahmed");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.goto("/fr/stock");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.getByText("Aucun article dans cette ferme.")).toBeVisible();

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  await page.getByRole("button", { name: "Ajouter un article" }).click();
  await page.getByLabel("Produit du catalogue (facultatif)").selectOption({ label: "Aliment démarrage" });
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("En stock : 0 kg")).toBeVisible();

  await page.getByRole("button", { name: "Enregistrer un achat" }).click();
  await page.getByLabel("Nom du nouveau fournisseur").fill("Alf Sahel");
  await page.getByLabel("Quantité (kg)").fill("2000");
  await page.getByLabel("Prix par kg (DH)").fill("4,50");
  await expect(page.getByText(/Montant : 9.000,00.DH/)).toBeVisible();
  await page.getByLabel("Payé maintenant (DH)").fill("3000");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/En stock : 2.000.kg/)).toBeVisible();
  await expect(page.getByText(/Reste dû : 6.000,00.DH/)).toBeVisible();

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByText(/En stock : 2.000.kg/)).toBeVisible();
  await expect(page.getByText(/Reste dû : 6.000,00.DH/)).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false);
  const purchase = async () =>
    (
      await query<{ amount: string; paid: string; quantity: number }>(
        `SELECT p."amountCentimes"::text AS amount, p."paidCentimes"::text AS paid, p.quantity FROM "Purchase" p
         JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
        [e164],
      )
    )[0] ?? null;
  await expect.poll(purchase).toEqual({ amount: "900000", paid: "300000", quantity: 2_000_000 });
});
