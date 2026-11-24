import { expect, test } from "@playwright/test";
import { farmDaysAgo, farmWithBatch, outboxEmpty, ownerWithFarm, pushAs, query, scopeRemembered } from "./auth";

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
  await expect(pay).toContainText("Paie validée le"); // saved on the phone
  await outboxEmpty(page);
  const server = () =>
    query<{ month: string }>(
      `SELECT p.month FROM "PayMonth" p JOIN "Membership" m ON m."organizationId" = p."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`,
      [e164],
    );
  await expect.poll(server).toEqual([{ month: today.slice(0, 7) }]);

  // The month's wages paid from the cash box: once, and in the books (D 4432 / C 5161).
  const wages = pay.getByRole("form", { name: "Payer les salaires : 150,00 DH" });
  await wages.getByLabel("Payé depuis").selectOption({ label: "la caisse" });
  await wages.getByRole("button", { name: "Payer les salaires : 150,00 DH" }).click();
  await expect(pay).toContainText(/Salaires payés : 150,00.DH le .* \(la caisse\)/);
  const booked = async () =>
    (
      await query<{ account: string; debit: string; credit: string }>(
        `SELECT l.account, l."debitCentimes"::text AS debit, l."creditCentimes"::text AS credit FROM "JournalLine" l JOIN "JournalEntry" j ON j.id = l."entryId"
         JOIN "Membership" m ON m."organizationId" = j."organizationId" JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1 AND j.label = 'Salaires payés' ORDER BY l.account`,
        [e164],
      )
    ).map((l) => `${l.account} ${l.debit} ${l.credit}`);
  await expect.poll(booked, { timeout: 20_000 }).toEqual(["4432 15000 0", "5161 0 15000"]);
});
