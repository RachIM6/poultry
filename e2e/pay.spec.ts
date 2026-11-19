import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

// T77 (SPEC-m4 WF11, WF12, §2): with no labour figures entered, /staff shows gross pay and says the rates are missing;
// the owner validates the month and it is frozen on the server.
test("pay without labour figures shows gross only, says so, and is validated by the owner", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Paie");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);
  const said = crypto.randomUUID();
  const today = farmDaysAgo(0);
  await pushAs(page, [
    { type: "workforce.createEmployee", payload: { id: said, farmId: ids.farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: farmDaysAgo(60), leftOn: null, dailyWageCentimes: "15000", cnssNumber: null, houseIds: [] } },
  ]);

  await page.goto("/fr/staff");
  // Today present, through the attendance form (an id per employee and day).
  const attendance = page.getByRole("form", { name: "Modifier la présence" });
  await attendance.getByRole("button", { name: "Enregistrer la présence" }).click();

  const pay = page.getByRole("region", { name: "Paie" });
  await expect(pay.getByRole("row", { name: /Said A\./ })).toContainText(/1\s*150,00\sDH\s*—\s*0,00\sDH\s*150,00\sDH/);
  await expect(pay.getByRole("note")).toContainText("aucune cotisation n’est calculée");

  await pay.getByRole("button", { name: `Valider la paie de ${today.slice(0, 7)}` }).click();
  const server = () =>
    query<{ month: string }>(
      `SELECT p.month FROM "PayMonth" p JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ month: today.slice(0, 7) }]);
  await expect(pay).toContainText("Paie validée le");
});
