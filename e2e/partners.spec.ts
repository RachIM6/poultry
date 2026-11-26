import { expect, test, type Page } from "@playwright/test";
import { farmWithBatch, login, ownerWithFarm, pushAs, query, randomMobile, scopeRemembered, inviteCode } from "./auth";

const orgOf = `(SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1)`;

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
  const code = await inviteCode(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Vétérinaire" })).toContainText("jusqu’au");

  const vetContext = await browser.newContext({ ...test.info().project.use });
  const vet = await vetContext.newPage();
  const e164 = await login(vet, "fr", phone, code);
  await expect(vet).toHaveURL(/\/fr\/dashboard$/);
  expect(await query<{ role: string; until: string }>(`SELECT m.role::text, m."accessUntil"::text AS until FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u."phoneNumber" = $1`, [e164])).toEqual([
    { role: "vet", until },
  ]);
  await vetContext.close();

  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: e164 })).toContainText("jusqu’au"); // now a member
});

/** The role the phone remembers, once the dashboard has seen the new one (a new role pulls everything again, T25 S5). */
const rememberedRole = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        const req = indexedDB.open("poultry-device");
        req.onsuccess = () => {
          const get = req.result.transaction("session").objectStore("session").get("current");
          get.onsuccess = () => (req.result.close(), resolve(get.result?.scope.role));
        };
      }),
  );

async function becomes(page: Page, e164: string, role: string) {
  await query(`UPDATE "Membership" SET role = '${role}' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  await expect.poll(() => rememberedRole(page), { timeout: 15_000 }).toBe(role);
  await expect(page.getByRole("link", { name: /^Bâtiment 1/ })).toBeVisible({ timeout: 30_000 }); // the batch, pulled again
}

// SPEC-m5 PA4, PA5, §5: a partner sees the forms their role may use and only the figures their phone receives.
test("the accountant reads money without production figures; the vet records health, not the day", async ({ page }) => {
  test.setTimeout(150_000);
  const e164 = await ownerWithFarm(page, "Élevage des Partenaires");
  await scopeRemembered(page);
  const ids = await farmWithBatch(page);

  await becomes(page, e164, "accountant");
  await expect(page.getByRole("link", { name: /Saisie du jour/ })).toHaveCount(0); // no daily entry on their phone
  await expect(page.getByRole("heading", { name: "Tâches du jour" })).toHaveCount(0); // no task of theirs, so no empty list
  await expect(page.getByRole("img", { name: /non saisi/ })).toHaveCount(0);
  await page.goto(`/fr/batches#${ids.batch}`);
  await expect(page.getByText("Effectifs, saisies du jour et chiffres d’élevage : non transmis à votre rôle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la journée" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Rapport de bande" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Registre de suivi sanitaire/ })).toHaveCount(0); // not all of it on their phone
  await page.goto("/fr/more");
  for (const name of [/^Créances des acheteurs/, /^Personnel/]) await expect(page.getByRole("link", { name })).toBeVisible(); // "›" ends each name
  for (const name of ["Stock d’œufs", "Comparer les bandes", "Tâches du jour", "Climat des bâtiments", "Planning des bandes", "Registre des visiteurs"]) {
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
  await page.goto("/fr/receivables");
  await expect(page.getByText("Aucun acheteur ne doit d’argent.")).toBeVisible();
  await page.goto("/fr/staff");
  await expect(page.getByText("Mois pas encore validé par le propriétaire.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter un ouvrier" })).toHaveCount(0);

  await becomes(page, e164, "vet");
  await expect(page.getByRole("link", { name: /Saisie du jour/ })).toHaveCount(0); // not the vet's to enter
  await expect(page.getByRole("heading", { name: "Tâches du jour" })).toBeVisible(); // the vaccinations due are the vet's
  await page.goto("/fr/batches");
  await expect(page.getByRole("link", { name: "Voir la bande" })).toBeVisible(); // the card opens the batch, not a day entry
  await expect(page.getByRole("link", { name: "Saisir le jour" })).toHaveCount(0);
  await page.goto(`/fr/batches#${ids.batch}`);
  await expect(page.getByRole("heading", { name: "Traitements" })).toBeVisible();
  await expect(page.getByText(/^Oiseaux présents/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer la journée" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer la pesée" })).toHaveCount(0);
});

// A worker enters the day but never places a batch (flock.manage): "Aujourd'hui" doesn't send them to place one.
test("a worker with no open batch is not offered a placement", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage de l’Ouvrier");
  await scopeRemembered(page);
  await pushAs(page, [{ type: "farm-registry.createFarm", payload: { id: crypto.randomUUID(), name: "Ferme Atlas", region: "R", province: "P", commune: "C", gps: null, onssa: null } }]);
  await page.reload();
  await expect(page.getByRole("link", { name: "Mettre en place une bande" })).toBeVisible({ timeout: 30_000 });
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.reload();
  await expect(page.getByText("Aucune bande en cours.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mettre en place une bande" })).toHaveCount(0);
});
