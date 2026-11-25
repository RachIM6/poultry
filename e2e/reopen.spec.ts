import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

// SPEC B6 "Reopening": the last sale was typed with the wrong weight and closed the batch. The owner reopens it with a
// reason, cancels the sale, types it again; the batch closes again and its cost per kg follows the right weight.
test("the owner reopens a closed batch, fixes its last sale and it closes again", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Réouverture");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(40)); // 1 000 chicks at 4,50 DH
  const buyer = crypto.randomUUID();
  await pushAs(page, [
    { type: "sales.createBuyer", payload: { id: buyer, name: "Abattoir Atlas", phone: null, type: "abattoir" } },
    {
      type: "sales.recordSale", // 2 000 kg typed for 2 100 kg: the batch closes on it
      payload: { id: crypto.randomUUID(), batchId: ids.batch, buyerId: buyer, day: farmDaysAgo(2), birds: 1000, farmWeightGrams: 2_000_000, buyerWeightGrams: null, pricePerKgCentimes: "1500", paymentMethod: "cash", paidCentimes: "3000000", instrument: null },
    },
  ]);
  const server = async () =>
    query<{ status: string; soldGrams: number | null }>(
      `SELECT b.status, b."soldGrams" FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );

  await page.goto(`/fr/batches#${ids.batch}`);
  await controlled(page);
  await referenceCached(page);
  const summary = page.getByRole("region", { name: "Bilan de la bande" });
  await expect(summary).toContainText("Tous les oiseaux ont été vendus.");

  await page.getByRole("button", { name: "Rouvrir la bande" }).click();
  await page.getByLabel("Motif de la réouverture").fill("Poids de la dernière vente mal saisi");
  await page.getByRole("button", { name: "Rouvrir", exact: true }).click();
  await expect(page.getByText("Oiseaux présents : 0")).toBeVisible(); // open again
  await outboxEmpty(page);
  await expect.poll(server).toEqual([{ status: "open", soldGrams: null }]);

  const sales = page.getByRole("list", { name: "Ventes" }).getByRole("listitem");
  page.once("dialog", (dialog) => dialog.accept());
  await sales.nth(0).getByRole("button", { name: /^Annuler la vente : .*Abattoir Atlas/ }).click();
  await expect(page.getByText("Oiseaux présents : 1 000")).toBeVisible(); // its birds are back

  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await page.getByLabel("Nom de l’acheteur").fill("Abattoir Atlas");
  await page.getByLabel("Nombre d’oiseaux").fill("1000");
  await page.getByLabel("Poids à la ferme (kg)").fill("2100");
  await page.getByLabel("Prix au kg (DH)").fill("15");
  await page.getByLabel("Montant reçu maintenant (DH)").fill("31500");
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();
  await expect(summary).toContainText("Tous les oiseaux ont été vendus."); // closed again by its last sale

  await outboxEmpty(page);
  await expect.poll(server).toEqual([{ status: "closed", soldGrams: 2_100_000 }]);
  // FN13: chicks 4 500 DH over 2 100 kg sold = 2,142 → 2,14 DH/kg (2,25 with the wrong weight)
  await expect(summary).toContainText("Vendu : 2 100 kg", { timeout: 30_000 });
  await expect(summary).toContainText(/Coût par kg vendu : 2,14\sDH/, { timeout: 30_000 });
});
