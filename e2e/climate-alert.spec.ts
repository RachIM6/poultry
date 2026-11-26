import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T82 (SPEC-m4 CL3, CL4): a reading above the owner's target shows the banner on the phone and reaches the inbox.
// The target below is made up for the test, NOT a husbandry figure (MQ1).
test("a reading above the target shows the banner and alerts the owner", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage des Alertes");
  await scopeRemembered(page);
  await farmWithBatch(page); // placed today: J0
  await pushAs(page, [
    { type: "climate.saveTargets", payload: { id: crypto.randomUUID(), validFrom: "2026-01-01", source: "Test E2E", bands: [{ fromAge: 0, toAge: 3, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: null, humidityMax: null, ammoniaMax: null }] } },
  ]);

  await page.goto("/fr/climate");
  const form = page.getByRole("form", { name: "Relevé de climat" });
  await expect(form.getByText(/cible à J0 : 10,0 – 20,0 °C/)).toBeVisible();
  await form.getByLabel("Température (°C)").fill("24,5");
  await expect(form.getByText(/cible à J0 : 10,0 – 20,0 °C · trop haut/)).toBeVisible();
  await form.getByLabel("Humidité (%)").fill("68");
  await form.getByRole("button", { name: "Enregistrer le relevé" }).click();
  await expect(page.getByText("Hors des cibles pour l’âge de la bande : trop chaud.")).toBeVisible();

  await expect(async () => {
    await page.goto("/fr/inbox");
    await expect(page.getByText("Climat hors cible : Bâtiment 1")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
});
