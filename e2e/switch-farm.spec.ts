import { expect, test, type Page } from "@playwright/test";
import { login, ownerWithFarm, randomMobile, scopeRemembered } from "./auth";

// T92 (SPEC-m5 PA2): a vet invited by two farms accepts the second from "Plus", switches between them, and the phone
// keeps one database per farm.
const invite = async (owner: Page, phone: string) => {
  await owner.goto("/fr/settings/members");
  await owner.getByLabel("Numéro de téléphone").fill(phone);
  await owner.getByLabel("Rôle", { exact: true }).selectOption("vet");
  await owner.getByRole("button", { name: "Inviter" }).click();
  await expect(owner.getByText("Invitation enregistrée.")).toBeVisible();
};

// The farm this phone has open: what SyncBadge stored once the dashboard rendered for the chosen farm.
const openFarm = (page: Page) =>
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
const farmDatabases = (page: Page) =>
  page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("poultry-") && n !== "poultry-device").length);

test("a vet accepts a second farm's invitation, switches between the farms, each with its own data on the phone", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const vetPhone = randomMobile();
  await ownerWithFarm(page, "Élevage Alpha");
  await invite(page, vetPhone);

  const vetContext = await browser.newContext({ ...test.info().project.use });
  const vet = await vetContext.newPage();
  await login(vet, "fr", vetPhone);
  await expect(vet).toHaveURL(/\/fr\/dashboard$/);
  await scopeRemembered(vet);
  const alpha = await openFarm(vet);
  expect(alpha).not.toBeNull();

  const ownerB = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await ownerWithFarm(ownerB, "Élevage Beta");
  await invite(ownerB, vetPhone);

  await vet.goto("/fr/more");
  await vet.getByRole("link", { name: "Changer d’exploitation" }).click();
  const farms = vet.getByRole("list", { name: "Mes exploitations" }).getByRole("listitem");
  await expect(farms.filter({ hasText: "Élevage Alpha" })).toContainText("Ouverte");
  await expect(vet.getByText("Élevage Beta vous invite comme Vétérinaire.")).toBeVisible();
  await vet.getByRole("button", { name: "Accepter l’invitation de Élevage Beta" }).click();
  await expect(vet).toHaveURL(/\/fr\/dashboard$/);
  await expect.poll(() => openFarm(vet)).not.toBe(alpha); // the phone switched to Beta
  await expect.poll(() => farmDatabases(vet)).toBe(2);

  await vet.goto("/fr/organizations");
  await expect(farms.filter({ hasText: "Élevage Beta" })).toContainText("Ouverte");
  await vet.getByRole("button", { name: "Ouvrir Élevage Alpha" }).click();
  await expect(vet).toHaveURL(/\/fr\/dashboard$/);
  await expect.poll(() => openFarm(vet)).toBe(alpha);
  await vet.goto("/fr/organizations");
  await expect(farms.filter({ hasText: "Élevage Alpha" })).toContainText("Ouverte");
  expect(await farmDatabases(vet)).toBe(2);
  await vetContext.close();
});
