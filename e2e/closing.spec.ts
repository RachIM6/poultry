import { expect, test } from "@playwright/test";
import { batchTab, controlled, farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, referenceCached, scopeRemembered } from "./auth";

// T24 acceptance, the whole lifecycle: a batch placed, fed, then all its birds sold offline. The last sale closes it on
// the phone at once; after the sync its cost per kg arrives, FN13's, read online as /results shows it (SPEC-finance §9
// "One cost per kg"); the house is free again. Since FN13 a cost of the batch is a quick expense charged to it: the
// batch screen links to /expenses, no other-cost form.
test("selling the last birds offline closes the batch; its cost per kg arrives with the sync and the house is free", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de la Clôture");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(40)); // 1 000 chicks at 4,50 DH; feed bought at 4,50 DH/kg
  await pushAs(page, [{ type: "flock.recordDay", payload: { batchId: ids.batch, day: farmDaysAgo(39), changes: { feed: { stockItemId: ids.feed, grams: 100_000 } } } }]); // 450 DH

  await page.goto(`/fr/batches?tab=ventes#${ids.batch}`);
  await controlled(page);
  await referenceCached(page);
  await expect(page.getByText("Oiseaux présents : 1 000")).toBeVisible();
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));

  const addCost = page.getByRole("link", { name: "Ajouter une charge dans Dépense rapide" });
  await expect(addCost).toHaveAttribute("href", "/fr/expenses");
  await expect(page.getByRole("button", { name: "Ajouter une charge" })).toHaveCount(0);

  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await page.getByLabel("Nom de l’acheteur").fill("Abattoir Atlas");
  await page.getByLabel("Nombre d’oiseaux").fill("1000");
  await page.getByLabel("Poids à la ferme (kg)").fill("2000");
  await page.getByLabel("Prix au kg (DH)").fill("15");
  await page.getByLabel("Montant reçu maintenant (DH)").fill("30000");
  await page.getByRole("button", { name: "Enregistrer la vente" }).click();

  await expect(page.getByRole("link", { name: "Document d’origine (Français)" })).toBeVisible(); // still printable
  await expect(page.getByRole("button", { name: "Nouvelle vente" })).toHaveCount(0); // closed by its last sale
  await batchTab(page, "Bilan");
  const summary = page.getByRole("region", { name: "Bilan de la bande" });
  await expect(summary).toContainText("Tous les oiseaux ont été vendus.");
  await expect(summary).toContainText("Les chiffres définitifs arrivent à la prochaine synchronisation.");
  for (const gone of ["Saisir", "Nouvelle vente", "Clôturer la bande"]) {
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0); // read-only
  }
  await expect(addCost).toHaveCount(0);

  await context.unroute("**");
  await context.setOffline(false);
  // FN13: chicks 4 500 DH + feed 450 DH = 4 950 DH (no direct or shared expense), over 2 000 kg sold = 2,475 → 2,48 DH/kg.
  await expect(summary).toContainText(/Coût par kg vendu : 2,48\sDH/, { timeout: 30_000 });
  await expect(summary).toContainText("Vendu : 2 000 kg");
  await pushAs(page, [
    {
      type: "flock.placeBatch",
      payload: { id: crypto.randomUUID(), houseId: ids.house, strainId: "ross-308", placedOn: farmDaysAgo(0), chicksPlaced: 1000, deadOnArrival: 0, hatchery: "H", deliveryNote: "BL", chickUnitPriceCentimes: "450", dayOldWeightGrams: null },
    },
  ]); // the house is free
});
