import { expect, test } from "@playwright/test";
import { ownerWithFarm } from "./auth";

// T9 acceptance: offline write → reload offline → back online → sent; a refused one waits in "needs attention".
test("an offline write survives a reload, then syncs; a refused one waits in 'needs attention'", async ({ page, context }) => {
  test.setTimeout(60_000);
  await ownerWithFarm(page, "Ferme Hors-Ligne"); // the dashboard remembers who is signed in and starts syncing
  await expect(page.getByRole("link", { name: "Tout est envoyé." })).toBeVisible();
  await page.goto("/fr/sync");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect(page.getByText("Tout est envoyé.")).toBeVisible();

  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  // No screen writes yet (farms come with T10): queue a mutation the way writeLocal stores it, with a type the
  // server doesn't know, so it comes back rejected.
  await page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const device = await open("poultry-device");
    const current = await new Promise<{ scope: { userId: string; organizationId: string } }>((resolve) => {
      const req = device.transaction("session").objectStore("session").get("current");
      req.onsuccess = () => resolve(req.result);
    });
    const db = await open(`poultry-${current.scope.userId}:${current.scope.organizationId}`);
    await new Promise((resolve, reject) => {
      const tx = db.transaction("outbox", "readwrite");
      tx.objectStore("outbox").add({ id: crypto.randomUUID(), type: "test.unknown", payload: {}, createdAt: new Date().toISOString() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    device.close();
  });

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true); // the static shell, from the precache
  await expect(page.getByText("Modifications en attente d’envoi : 1")).toBeVisible();
  await expect(page.getByText("Pas de réseau pour l’instant. Nouvel essai automatique.")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false); // the "online" event starts a sync
  await expect(page.getByText("Tout est envoyé.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "À vérifier" })).toBeVisible();
  await expect(page.getByText("Cette action n’est pas reconnue. Mettez l’application à jour.")).toBeVisible();

  await page.getByRole("button", { name: "J’ai compris" }).click();
  await expect(page.getByRole("heading", { name: "À vérifier" })).toHaveCount(0);
});

test("signed-in pages and API responses are never kept by the service worker", async ({ page }) => {
  await ownerWithFarm(page, "Ferme Cache");
  await page.goto("/fr/sync");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("link", { name: "Tout est envoyé." })).toBeVisible(); // a sync (push + pull) ran

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached.filter((path) => /\/dashboard|\/api\/|\/settings|\/onboarding/.test(path))).toEqual([]);
  expect(cached).toContain("/fr/sync");
});
