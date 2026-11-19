import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, scopeRemembered } from "./auth";

// T84 (SPEC-m4 CL6): the house's last readings with their verdicts, newest first, and the farm's last cuts with their
// duration. The target is made up for the test, NOT a husbandry figure (MQ1).
test("the climate page lists the house's last readings with verdicts and the last power cuts", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de l’Historique");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page, "ross-308", farmDaysAgo(2));
  const reading = (time: string, temperatureTenths: number) => ({ type: "climate.recordReading", payload: { id: crypto.randomUUID(), houseId: ids.house, day: farmDaysAgo(0), time, temperatureTenths, humidity: 60, ammonia: null } });
  const cut = crypto.randomUUID();
  await pushAs(page, [
    { type: "climate.saveTargets", payload: { id: crypto.randomUUID(), validFrom: "2026-01-01", source: "Test E2E", bands: [{ fromAge: 0, toAge: 5, temperatureMinTenths: 100, temperatureMaxTenths: 200, humidityMin: null, humidityMax: null, ammoniaMax: null }] } },
    reading("08:00", 150),
    reading("14:00", 245),
    { type: "climate.startPowerCut", payload: { id: cut, farmId: ids.farm, startedAt: "2026-11-03T14:20:00Z" } },
    { type: "climate.endPowerCut", payload: { id: cut, endedAt: "2026-11-03T15:05:00Z", generatorStarted: true, generatorSeconds: 40, dieselMl: 18_000 } },
  ]);

  await page.goto("/fr/climate");
  const readings = page.getByRole("list", { name: "Derniers relevés" }).getByRole("listitem");
  await expect(readings).toHaveText([/14:00\s*24,5 °C · 60 %\s*trop chaud/, /08:00\s*15,0 °C · 60 %\s*dans la cible/]);
  await expect(page.getByRole("list", { name: "Dernières coupures" }).getByRole("listitem")).toHaveText([/45 min · groupe en 40 s · 18 L de gasoil/]);
});
