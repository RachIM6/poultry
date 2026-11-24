import { expect, test } from "@playwright/test";
import { ownerWithFarm, scopeRemembered } from "./auth";

// T9 acceptance: offline write → reload offline → back online → sent; a refused one waits in "needs attention".
test("an offline write survives a reload, then syncs; a refused one waits in 'needs attention'", async ({ page, context }) => {
  test.setTimeout(60_000);
  await ownerWithFarm(page, "Ferme Hors-Ligne"); // the dashboard remembers who is signed in and starts syncing
  await expect(page.getByRole("link", { name: "Tout est envoyé." })).toBeVisible();
  await scopeRemembered(page); // the badge renders before its effect has stored the scope
  await page.goto("/fr/sync");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect(page.getByText("Tout est envoyé.")).toBeVisible();

  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  // Queue mutations the way writeLocal stores them, both refused by the server: a type it doesn't know, and a day for
  // a batch that doesn't exist.
  const batchId = "0197a3c2-0000-7000-8000-000000000001";
  await page.evaluate(async (batchId) => {
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
      const createdAt = new Date().toISOString();
      tx.objectStore("outbox").add({ id: crypto.randomUUID(), type: "test.unknown", payload: {}, createdAt });
      tx.objectStore("outbox").add({ id: crypto.randomUUID(), type: "flock.recordDay", payload: { batchId, day: "2026-11-20", changes: { dead: 3 } }, createdAt });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    device.close();
  }, batchId);

  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true); // the static shell, from the precache
  await expect(page.getByText("Modifications en attente d’envoi : 2")).toBeVisible();
  await expect(page.getByText("Pas de réseau pour l’instant. Nouvel essai automatique.")).toBeVisible();

  await context.unroute("**");
  await context.setOffline(false); // the "online" event starts a sync
  await expect(page.getByText("Tout est envoyé.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "À vérifier" })).toBeVisible();
  await expect(page.getByText("Cette action n’est pas reconnue. Mettez l’application à jour.")).toBeVisible();
  // Each refused write says what it was, what was typed and where to type it again; the nav counts them.
  await expect(page.getByRole("heading", { name: "Action inconnue" })).toBeVisible();
  const day = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Saisie du jour" }) });
  await expect(day.getByText("changes.dead: 3")).toBeVisible();
  await expect(day.getByRole("link", { name: "Saisir à nouveau" })).toHaveAttribute("href", `/fr/batches#${batchId}`);
  await expect(page.getByRole("link", { name: /2 écritures refusées à vérifier/ })).toBeVisible();
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("link", { name: "2 écritures refusées à vérifier", exact: true })).toBeVisible();

  // Dismissing asks first: cancelled, the entry and what was typed stay.
  await page.goto("/fr/sync");
  page.once("dialog", (dialog) => dialog.dismiss());
  await day.getByRole("button", { name: "J’ai compris" }).click();
  await expect(day).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  for (const name of ["Saisie du jour", "Action inconnue"]) {
    await page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) }).getByRole("button", { name: "J’ai compris" }).click();
  }
  await expect(page.getByRole("heading", { name: "À vérifier" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /écritures? refusées? à vérifier/ })).toHaveCount(0);
});

test("signed-in pages and API responses are never kept by the service worker", async ({ page }) => {
  await ownerWithFarm(page, "Ferme Cache");
  await page.goto("/fr/sync");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const pulled = page.waitForResponse((res) => res.url().includes("/api/sync/pull") && res.status() === 200);
  await page.goto("/fr/dashboard");
  await pulled; // sync data went through the service worker

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
