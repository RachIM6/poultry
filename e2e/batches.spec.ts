import { expect, test } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { batchTab, controlled, farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, referenceCached, scopeRemembered } from "./auth";

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
  await expect(page.getByText("Bâtiment 1 · Ross 308", { exact: true })).toBeVisible(); // UX review B3: house and strain, then type and farm
  await expect(page.getByText("Poulet de chair · Ferme Atlas", { exact: true })).toBeVisible();

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

// SPEC B1: the phone refuses, offline, a placement day after the batch's first health record, as the server does: a
// vet visit, then a treatment started (a vaccine given is the same rule, src/modules/health/domain/plan-edit.ts).
test("the placement correction is refused offline after a vet visit or a treatment", async ({ page, context }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage des Corrections");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(10));
  const medicine = crypto.randomUUID();
  await pushAs(page, [{ type: "health.recordVetVisit", payload: { id: crypto.randomUUID(), batchId: ids.batch, on: farmDaysAgo(3), vetName: "Dr Alaoui", notes: "" } }]);

  const refused = async (placedOn: string) => {
    await controlled(page);
    await referenceCached(page);
    await batchTab(page, "Gestion");
    const open = page.getByRole("button", { name: /^Corriger la mise en place/ });
    await expect(open).toBeVisible(); // its own chunk, loaded online
    await context.setOffline(true);
    await context.route("**", (route) => route.abort("internetdisconnected"));
    await open.click();
    const form = page.getByRole("form", { name: "Corriger la mise en place" });
    await form.getByLabel("Date de mise en place").fill(placedOn);
    await form.getByRole("button", { name: "Enregistrer la correction" }).click();
    await expect(form.getByRole("alert")).toHaveText("La mise en place ne peut pas suivre le premier soin saisi (vaccin donné, traitement ou visite du vétérinaire).");
    await form.getByRole("button", { name: "Annuler" }).click();
    await context.unroute("**");
    await context.setOffline(false);
  };
  await page.goto(`/fr/batches?tab=sante#${ids.batch}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("list", { name: "Visites vétérinaires" }).getByRole("listitem")).toHaveCount(1, { timeout: 2_000 }); // pulled
  }).toPass();
  await refused(farmDaysAgo(2)); // after the visit

  await pushAs(page, [
    { type: "inventory.createStockItem", payload: { id: medicine, farmId: ids.farm, productId: null, kind: "medicine", name: "Amoxicilline", unit: "ml", lot: "AMX-1", expiresOn: farmDaysAgo(-365) } },
    { type: "inventory.recordPurchase", payload: { id: crypto.randomUUID(), movementId: uuidv7(), supplierId: ids.supplier, stockItemId: medicine, day: farmDaysAgo(10), quantity: 1000, unitPriceCentimes: "50", paidCentimes: "0", dueOn: null } },
    { type: "health.recordTreatment", payload: { id: uuidv7(), batchId: ids.batch, stockItemId: medicine, quantity: 100, dose: "1 ml/L", startOn: farmDaysAgo(6), endOn: farmDaysAgo(5), reason: "Toux", prescriber: "Dr Alaoui", withdrawalDays: 0 } },
  ]);
  await expect(async () => {
    await page.goto(`/fr/batches?tab=sante#${ids.batch}`);
    await page.reload();
    await expect(page.getByRole("list", { name: "Traitements" }).getByRole("listitem")).toHaveCount(1, { timeout: 2_000 }); // pulled
  }).toPass();
  await refused(farmDaysAgo(5)); // before the visit, after the treatment's start

  await outboxEmpty(page); // nothing was queued
  const placed = await query<{ day: string }>(
    `SELECT b."placedOn"::text AS day FROM "Batch" b JOIN "Membership" m ON m."organizationId" = b."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
    [e164],
  );
  expect(placed).toEqual([{ day: farmDaysAgo(10) }]);
});
