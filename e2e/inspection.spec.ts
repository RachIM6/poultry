import { expect, test } from "@playwright/test";
import { controlled, farmDaysAgo, farmWithBatch, ownerWithFarm, pulled, pushAs, referenceCached, scopeRemembered } from "./auth";

// T49 acceptance: a farm's inspection pack opens offline, lists what is missing, holds the logs and each batch's
// register, and prints within an A4 width (SPEC-m2-compliance RP4). The checklist rules: reporting/domain/inspection.test.ts.
test("the inspection pack opens offline, lists the missing pieces and prints", async ({ page, context }) => {
  test.setTimeout(150_000);
  await ownerWithFarm(page, "Élevage de l’Inspection");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(20)); // a farm without ONSSA authorization
  const logged = { rodentCheck: crypto.randomUUID(), visit: crypto.randomUUID(), document: crypto.randomUUID() };
  await pushAs(page, [
    { type: "biosecurity.recordRodentCheck", payload: { id: logged.rodentCheck, farmId: ids.farm, houseId: null, day: farmDaysAgo(2), action: "baitPlaced", product: "Brodifacoum" } },
    {
      type: "biosecurity.recordVisit",
      payload: { id: logged.visit, farmId: ids.farm, enteredAt: new Date().toISOString(), visitor: "Dr Naïma R.", vehicle: null, purpose: "vet", recentFarm: false, wheelsDisinfected: true, footbath: true, farmClothing: true, zone: "clean" },
    },
    { type: "documents.createDocument", payload: { id: logged.document, title: "Contrat du vétérinaire", category: "vetContract", farmId: null, issuedOn: null, expiresOn: farmDaysAgo(5), notes: null } },
  ]);
  await page.goto("/fr/more");
  await page.getByRole("link", { name: "Dossier d’inspection" }).click();
  await controlled(page);
  await referenceCached(page);
  await pulled(page, Object.entries(logged).map(([entity, id]) => `${entity}:${id}`)); // the h1 below only proves the first push
  const pack = page.getByRole("article").first();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossier d’inspection · Ferme Atlas"); // one h1: the registers inside are h2

  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  const missing = page.getByRole("list", { name: "À compléter" });
  for (const item of ["Autorisation sanitaire non renseignée", "Contrat du vétérinaire sanitaire absent ou expiré", /Dératisation du .+ sans photo/]) {
    await expect(missing.getByRole("listitem").filter({ hasText: item })).toHaveCount(1);
  }
  await expect(pack).toContainText("Arrêté n° 2127-05, art. 4"); // each checklist line prints its source
  await expect(pack).toContainText("Arrêté n° 2127-05, art. 4 ; décret n° 2-04-684, art. 12"); // R1: the manure line
  await expect(pack).toContainText("ouvertures munies de filets ou de grillage contre les oiseaux et les rongeurs"); // R1: buildings
  await expect(pack).not.toContainText("local de stockage des œufs"); // a broiler farm: no layer stores line
  await expect(pack).toContainText("Maladies à déclaration obligatoire (dahir n° 1-75-292, art. 1 et 3"); // R2
  await expect(pack).toContainText("Dr Naïma R.");
  await expect(pack).toContainText("Appâts posés");
  await expect(page.getByRole("heading", { level: 2, name: "Registre de suivi sanitaire" })).toHaveCount(1); // the open batch's register

  // tasks/plan-ui-cleanup.md §4: a table of contents on screen; a link scrolls to its part without changing the hash (the farm's).
  const contents = page.getByRole("navigation", { name: "Sommaire" });
  await expect(contents.getByRole("link")).toHaveText([
    "Points de contrôle", "Documents", "Nettoyage et vide sanitaire", "Registre des visiteurs", "Cadavres éliminés", "Fumier",
    "Dératisation", /^Registre, bande Bâtiment 1 du /,
  ]);
  const url = page.url();
  await contents.getByRole("link", { name: "Dératisation" }).click();
  await expect(page.locator("#rodents")).toBeFocused();
  expect(page.url()).toBe(url);

  await page.emulateMedia({ media: "print" });
  await expect(contents).toBeHidden(); // paper: the document alone
  await page.setViewportSize({ width: 794, height: 1123 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.pdf({ format: "A4", preferCSSPageSize: true, path: test.info().outputPath("inspection-fr.pdf") });
});
