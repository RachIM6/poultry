import { expect, test, type Page } from "@playwright/test";
import { farmWithBatch, inviteCode, login, ownerWithFarm, randomMobile, scopeRemembered } from "./auth";

// The demo rehearsal: a tab opened right after signing in, before the dashboard had rendered, showed « Connectez-vous
// pour synchroniser ce téléphone ». The phone now remembers who is signed in before it navigates (src/lib/api.ts
// rememberSignedIn). Each test holds the dashboard back, so nothing it renders can store the scope instead.
const holdDashboard = (page: Page) => page.route(/\/fr\/dashboard/, () => {}); // never answered
const release = (page: Page) => page.unrouteAll({ behavior: "ignoreErrors" });

/** The organisation the phone has open ("poultry-device", src/offline/db.ts). */
const storedFarm = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open("poultry-device");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("session")) return (db.close(), resolve(null));
          const get = db.transaction("session").objectStore("session").get("current");
          get.onsuccess = () => (db.close(), resolve((get.result?.scope?.organizationId as string | undefined) ?? null));
        };
        req.onerror = () => resolve(null);
      }),
  );

const BATCH = "Poulet de chair · Ferme Atlas"; // a list card's type and farm (its title: house and strain)
const SIGNED_OUT = "Connectez-vous pour synchroniser ce téléphone.";

async function batchesShow(page: Page, text: string) {
  await page.goto("/fr/batches");
  await expect(page.getByText(text)).toBeVisible({ timeout: 30_000 }); // pulled by the screen itself
  await expect(page.getByText(SIGNED_OUT)).toHaveCount(0);
}

test("signed in on a new phone, Lots opened before the dashboard shows the farm's batches", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage Direct");
  await scopeRemembered(page);
  await farmWithBatch(page);

  const phone = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await holdDashboard(phone);
  await login(phone, "fr", e164); // password sign-in
  await scopeRemembered(phone);
  await release(phone);
  await batchesShow(phone, BATCH);
});

test("a vet who joins with a code, then joins and opens other farms, has each farm open before the dashboard", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const vetPhone = randomMobile();
  const invite = async (owner: Page) => {
    await owner.goto("/fr/settings/members");
    await owner.getByRole("button", { name: "Inviter un membre" }).click(); // the invite form is in a sheet
    await owner.getByLabel("Numéro de téléphone").fill(vetPhone);
    await owner.getByLabel("Rôle", { exact: true }).selectOption("vet");
    await owner.getByRole("button", { name: "Inviter", exact: true }).click();
    return inviteCode(owner);
  };
  await ownerWithFarm(page, "Élevage Alpha");
  await scopeRemembered(page);
  await farmWithBatch(page);
  const alphaCode = await invite(page);

  // The partner join path: a new account with the owner's code (/join).
  const vet = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await holdDashboard(vet);
  await login(vet, "fr", vetPhone, alphaCode);
  await scopeRemembered(vet);
  const alpha = await storedFarm(vet);
  await release(vet);
  await batchesShow(vet, BATCH);

  const ownerB = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await ownerWithFarm(ownerB, "Élevage Beta");
  const betaCode = await invite(ownerB);

  // Joining a second farm with its code opens it (switch farm, ADR-013).
  await vet.goto("/fr/organizations");
  await holdDashboard(vet);
  await vet.getByLabel("Code", { exact: true }).fill(betaCode);
  await vet.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect.poll(() => storedFarm(vet)).not.toBe(alpha);
  await release(vet);
  await batchesShow(vet, "Aucune bande pour l’instant."); // Beta's own database: no batch yet

  // Back to the first farm from "Mes exploitations".
  await vet.goto("/fr/organizations");
  await holdDashboard(vet);
  await vet.getByRole("button", { name: "Ouvrir Élevage Alpha" }).click();
  await expect.poll(() => storedFarm(vet)).toBe(alpha);
  await release(vet);
  await batchesShow(vet, BATCH);
});
