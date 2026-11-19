import { expect, test } from "@playwright/test";
import { login, ownerWithFarm, query, randomMobile } from "./auth";

// T90 (SPEC-m5 PA1): the owner invites the vet until a day; the vet signs in to the farm, listed with that end day.
test("the owner invites a vet with an end day; the vet signs in and is listed until that day", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage du Vétérinaire");
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await expect(page.getByLabel("Accès jusqu’au (facultatif)")).toHaveCount(0); // staff have no end day
  await page.getByLabel("Rôle", { exact: true }).selectOption("vet");
  await page.getByLabel("Accès jusqu’au (facultatif)").fill(until);
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Vétérinaire" })).toContainText("jusqu’au");

  const vetContext = await browser.newContext({ ...test.info().project.use });
  const vet = await vetContext.newPage();
  const e164 = await login(vet, "fr", phone);
  await expect(vet).toHaveURL(/\/fr\/dashboard$/);
  expect(await query<{ role: string; until: string }>(`SELECT m.role::text, m."accessUntil"::text AS until FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164])).toEqual([
    { role: "vet", until },
  ]);
  await vetContext.close();

  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: e164 })).toContainText("jusqu’au"); // now a member
});
