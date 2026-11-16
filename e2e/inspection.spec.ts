import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, referenceCached, scopeRemembered } from "./auth";

// T49 acceptance: a farm's inspection pack opens offline, lists what is missing, holds the logs and each batch's
// register, and prints within an A4 width (SPEC-m2-compliance RP4). The checklist rules: reporting/domain/inspection.test.ts.
test("the inspection pack opens offline, lists the missing pieces and prints", async ({ page, context }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage de l’Inspection");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20)); // a farm without ONSSA authorization
  await pushAs(page, [
    { type: "biosecurity.recordRodentCheck", payload: { id: crypto.randomUUID(), farmId: ids.farm, houseId: null, day: farmDaysAgo(2), action: "baitPlaced", product: "Brodifacoum" } },
    {
      type: "biosecurity.recordVisit",
      payload: { id: crypto.randomUUID(), farmId: ids.farm, enteredAt: new Date().toISOString(), visitor: "Dr Naïma R.", vehicle: null, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" },
    },
    { type: "documents.createDocument", payload: { id: crypto.randomUUID(), title: "Contrat du vétérinaire", category: "vetContract", farmId: null, issuedOn: null, expiresOn: farmDaysAgo(5), notes: null } },
  ]);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Dossier d’inspection" }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await referenceCached(page);
  const pack = page.getByRole("article").first();
  await expect(pack.getByRole("heading", { level: 1 }).first()).toHaveText("Dossier d’inspection · Ferme Atlas");

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  const missing = page.getByRole("list", { name: "À compléter" }).getByRole("listitem");
  await expect(missing).toHaveText([
    "Autorisation sanitaire non renseignée",
    "Contrat du vétérinaire sanitaire absent ou expiré",
    "Document expiré : Contrat du vétérinaire",
    /^Dératisation du .+ sans photo$/,
  ]);
  await expect(pack).toContainText("Dr Naïma R.");
  await expect(pack).toContainText("Appâts posés");
  await expect(page.getByRole("heading", { level: 1, name: "Registre d’élevage" })).toHaveCount(1); // the open batch's register

  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 794, height: 1123 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath("inspection-fr.pdf") });
});
