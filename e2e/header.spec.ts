import { expect, test, type Page } from "@playwright/test";
import { outboxEmpty, ownerWithFarm, query, scopeRemembered } from "./auth";
import { orgOf } from "./screens";

// tasks/plan-ui.md U20: one header bar on every signed-in screen, its controls at the end (left in Arabic): the sync
// chip and the bell (tasks/plan-ui-cleanup.md §3), then the profile (avatar, name, role) opening the account menu
// (names, farms, language, sign-out).
const WIDE = { width: 1440, height: 900 };
const profile = (page: Page) => page.getByRole("banner").locator("button[aria-controls]").last(); // after the bell
const menu = (page: Page) => profile(page).locator("xpath=following-sibling::div[1]"); // the panel it controls
const bell = (page: Page, name = "Notifications") => page.getByRole("banner").getByRole("button", { name });
const bellPanel = (page: Page) => bell(page).locator("xpath=following-sibling::div[1]");
const chip = (page: Page) => page.getByRole("banner").getByRole("link", { name: /^Synchronisation :/ });
/** The phone's records and outbox, written as Dexie stores them (sync.spec.ts): the page reloads to read them. */
const writeLocal = (page: Page, store: "records" | "outbox", rows: object[]) =>
  page.evaluate(
    async ([store, rows]) => {
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
        const tx = db.transaction(store as string, "readwrite");
        for (const row of rows as object[]) tx.objectStore(store as string).put(row);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      device.close();
    },
    [store, rows] as const,
  );
const deviceSession = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ name?: string; role?: string } | null>((resolve) => {
        const req = indexedDB.open("poultry-device");
        req.onsuccess = () => {
          const get = req.result.transaction("session").objectStore("session").get("current");
          get.onsuccess = () => (req.result.close(), resolve(get.result?.scope ?? null));
        };
      }),
  );

test("wide screens: the same header on every screen, the menu by keyboard, the language switched from it", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de l’En-tête", { first: "Nadia", last: "Bennani" });
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);

  for (const path of ["/fr/dashboard", "/fr/batches", "/fr/stock", "/fr/treasury", "/fr/inbox"]) {
    await page.goto(path);
    await expect(bell(page), path).toBeVisible();
    await expect(chip(page), path).toBeVisible();
    await expect(profile(page), path).toHaveAccessibleName("Nadia Bennani Propriétaire");
    await expect(profile(page).getByText("Nadia Bennani")).toBeVisible(); // beside the avatar on wide screens
    const box = (await profile(page).boundingBox())!;
    expect(WIDE.width - (box.x + box.width), path).toBeLessThanOrEqual(25); // at the end: the right
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(profile(page).locator("span[aria-hidden]").filter({ hasText: /^NB$/ })).toBeVisible(); // the avatar’s initials

  // Keyboard: Enter opens, Tab goes into the menu, Escape closes it with the focus back on the profile.
  await profile(page).focus();
  await page.keyboard.press("Enter");
  await expect(profile(page)).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toHaveAttribute("id", (await profile(page).getAttribute("aria-controls"))!);
  await page.keyboard.press("Tab");
  await expect(menu(page).getByRole("link", { name: "Votre nom" })).toBeFocused();
  for (const name of ["Mes exploitations", "العربية", "Français"]) await expect(menu(page).getByRole("link", { name })).toBeVisible();
  for (const name of ["Se déconnecter", "Déconnecter tous mes appareils"]) await expect(menu(page).getByRole("button", { name })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(profile(page)).toBeFocused();
  await expect(profile(page)).toHaveAttribute("aria-expanded", "false");
  // A click outside closes it too.
  await profile(page).click();
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  await expect(menu(page)).toBeHidden();

  // The bell's panel leads to the notifications.
  await bell(page).click();
  await bellPanel(page).getByRole("link", { name: "Toutes les notifications" }).click();
  await page.waitForURL(/\/fr\/inbox$/);
  await expect(bellPanel(page)).toBeHidden();

  // The language, from the menu: the same page in Arabic, the bar mirrored (the profile and its menu on the left).
  await profile(page).click();
  await menu(page).getByRole("link", { name: "العربية" }).click();
  await page.waitForURL(/\/ar\/inbox$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(profile(page)).toHaveAccessibleName("Nadia Bennani المالك");
  await profile(page).click();
  const [button, opened] = [(await profile(page).boundingBox())!, (await menu(page).boundingBox())!];
  expect(button.x).toBeLessThanOrEqual(25);
  expect(opened.x).toBeLessThanOrEqual(button.x + 1); // opens towards the page, from the left edge
  const bellBox = (await bell(page, "الإشعارات").boundingBox())!;
  expect(bellBox.x).toBeGreaterThan(button.x + button.width - 1); // then the bell, after the profile
  const chipBox = (await page.getByRole("banner").getByRole("link", { name: /^المزامنة :/ }).boundingBox())!;
  expect(chipBox.x).toBeGreaterThan(bellBox.x + bellBox.width - 1); // then the sync chip
});

test("wide screens: the header is laid out before it loads, nothing moves when the name arrives", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage Immobile");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.addInitScript(() => {
    const w = window as unknown as { shifts: number };
    w.shifts = 0;
    new PerformanceObserver((list) => list.getEntries().forEach((e) => (w.shifts += (e as unknown as { value: number }).value))).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/fr/closing/count", { waitUntil: "load" });
  await expect(profile(page)).toHaveAccessibleName("Nadia Testeur Propriétaire");
  expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBe(0);
});

test("the phone: a compact bar with the bell and the avatar, the same menu, signing out from it", async ({ page }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage du Pouce");
  await scopeRemembered(page);
  for (const path of ["/fr/dashboard", "/fr/batches", "/fr/more"]) {
    await page.goto(path);
    await expect(bell(page), path).toBeVisible();
    await expect(profile(page), path).toHaveAccessibleName("Nadia Testeur Propriétaire");
    const box = (await profile(page).boundingBox())!;
    expect(box.width).toBe(44); // the avatar only; the name is in the menu
    // The sync chip, whole, in the bar; the home no longer shows its own badge (tasks/plan-ui-cleanup.md §3).
    await expect(chip(page), path).toHaveAccessibleName("Synchronisation : Tout est envoyé");
    const c = (await chip(page).boundingBox())!;
    expect(c.x, path).toBeGreaterThanOrEqual(16);
    expect(await chip(page).locator(".truncate").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("main").getByRole("link", { name: /Tout est envoyé/ })).toHaveCount(0);
  // The bell's panel hangs from the bar, inside the screen's gutters.
  await bell(page).click();
  const panel = (await bellPanel(page).boundingBox())!;
  expect(panel.x).toBe(16);
  expect(panel.x + panel.width).toBe(page.viewportSize()!.width - 16);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Plus", exact: true })).toBeVisible(); // the tabs stay
  // « Plus » lists screens; the language and the sign-out moved to the header.
  await expect(page.getByRole("main").getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("navigation", { name: "Langue" })).toHaveCount(0);

  await profile(page).click();
  await expect(menu(page).getByText("Nadia Testeur")).toBeVisible();
  await expect(menu(page).getByText("Propriétaire")).toBeVisible();
  expect((await menu(page).boundingBox())!.x).toBeGreaterThanOrEqual(0); // inside the screen
  await menu(page).getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/fr\/login$/);
  const sessions = await query<{ n: number }>(`SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u."phoneNumber" = $1`, [e164]);
  expect(sessions[0].n).toBe(0);
  expect(await deviceSession(page)).toBeNull(); // the phone forgot who was signed in, as from /more before
});

test("an account from before names shows its phone and names itself from the menu; a worker reads « Ouvrier »", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage d’Avant");
  await scopeRemembered(page);
  // As made before U20: no first or last name, the phone as `name`, and a phone that never stored a name.
  await query(`UPDATE "User" SET "firstName" = NULL, "lastName" = NULL, name = "phoneNumber" WHERE "phoneNumber" = $1`, [e164]);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("poultry-device");
        req.onsuccess = () => {
          const store = req.result.transaction("session", "readwrite").objectStore("session");
          const get = store.get("current");
          get.onsuccess = () => {
            delete get.result.scope.name;
            store.put(get.result).onsuccess = () => (req.result.close(), resolve());
          };
        };
      }),
  );
  await page.goto("/fr/dashboard");
  await expect(profile(page)).toHaveAccessibleName(`${e164} Propriétaire`); // asked the server once, then kept
  await expect.poll(async () => (await deviceSession(page))?.name).toBe(e164);

  await profile(page).click();
  await menu(page).getByRole("link", { name: "Votre nom" }).click();
  await page.waitForURL(/\/fr\/organizations#name$/);
  await page.getByLabel("Prénom", { exact: true }).fill(" Hamid ");
  await page.getByLabel("Nom", { exact: true }).fill("Ouazzani");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nom enregistré." })).toBeVisible();
  await expect(profile(page)).toHaveAccessibleName("Hamid Ouazzani Propriétaire");
  const [user] = await query<{ firstName: string; lastName: string; name: string }>(`SELECT "firstName", "lastName", name FROM "User" WHERE "phoneNumber" = $1`, [e164]);
  expect(user).toEqual({ firstName: "Hamid", lastName: "Ouazzani", name: "Hamid Ouazzani" });
  // Refused on the server too: letters only.
  await page.getByLabel("Nom", { exact: true }).fill("<b>");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "des lettres seulement" })).toBeVisible();

  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  await expect(profile(page)).toHaveAccessibleName("Hamid Ouazzani Ouvrier");
});

test("the bell: the 5 latest unread in a panel, by keyboard, all marked read at once", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Cloche");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);

  // Two real notifications (the inbox's test), pulled onto the phone.
  for (let i = 0; i < 2; i++) {
    const status = await page.evaluate(() => fetch("/api/notifications/test", { method: "POST", headers: { "x-requested-with": "poultry" } }).then((r) => r.status));
    expect(status).toBe(201);
  }
  await page.reload();
  await expect(bell(page, "Notifications, 2 non lues")).toBeVisible({ timeout: 30_000 });
  await expect(bell(page).getByText("2", { exact: true })).toBeVisible(); // the count stays on the bell

  // Enter opens it, Tab goes into it, Escape closes it with the focus back on the bell.
  await bell(page).focus();
  await page.keyboard.press("Enter");
  await expect(bell(page)).toHaveAttribute("aria-expanded", "true");
  await expect(bellPanel(page)).toHaveAttribute("id", (await bell(page).getAttribute("aria-controls"))!);
  await expect(bellPanel(page).getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(bellPanel(page).getByRole("listitem")).toHaveCount(2);
  await expect(bellPanel(page).getByRole("listitem").first()).toContainText("Les notifications arrivent bien sur ce téléphone.");
  await page.keyboard.press("Tab");
  await expect(bellPanel(page).getByRole("button", { name: "Tout marquer lu" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bellPanel(page)).toBeHidden();
  await expect(bell(page)).toBeFocused();
  // A click outside closes it; so does opening the account menu.
  await bell(page).click();
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  await expect(bellPanel(page)).toBeHidden();
  await bell(page).click();
  await profile(page).click();
  await expect(bellPanel(page)).toBeHidden();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // « Tout marquer lu »: read here at once, the focus on « Toutes les notifications », the receipts synced.
  await bell(page).click();
  await bellPanel(page).getByRole("button", { name: "Tout marquer lu" }).click();
  await expect(bellPanel(page).getByText("Aucune notification non lue.")).toBeVisible();
  await expect(bellPanel(page).getByRole("link", { name: "Toutes les notifications" })).toBeFocused();
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await outboxEmpty(page);
  const unread = async () =>
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u."phoneNumber" = $1 AND n."readAt" IS NULL`, [e164]))[0].n;
  await expect.poll(unread).toBe(0);
  await page.keyboard.press("Escape");

  // Seven unread on the phone: the panel shows the 5 latest, the newest first; the rest are on /inbox.
  const at = (m: number) => new Date(Date.UTC(2026, 10, 20, 8, m)).toISOString();
  await writeLocal(
    page,
    "records",
    Array.from({ length: 7 }, (_, i) => {
      const id = `0197a3c2-0000-7000-8000-00000000000${i}`;
      return { key: `notification:${id}`, entity: "notification", id, data: { id, userId: "", templateKey: "test", params: {}, urgent: false, createdAt: at(i), readAt: null } };
    }),
  );
  await page.reload();
  await expect(bell(page, "Notifications, 7 non lues")).toBeVisible();
  await bell(page).click();
  const items = bellPanel(page).getByRole("listitem");
  await expect(items).toHaveCount(5);
  const time = (m: number) => new Intl.DateTimeFormat("fr", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Casablanca" }).format(new Date(at(m)));
  await expect(items.first()).toContainText(time(6));
  await expect(items.last()).toContainText(time(2));
  await bellPanel(page).getByRole("link", { name: "Toutes les notifications" }).click();
  await page.waitForURL(/\/fr\/inbox$/);
});

test("the sync chip: sent, waiting, offline, refused, each in the same box, to /sync", async ({ page, context }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Synchronisé");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.goto("/fr/batches");
  await expect(chip(page)).toHaveAccessibleName("Synchronisation : Tout est envoyé");
  const width = async () => (await chip(page).boundingBox())!.width;
  expect(await width()).toBe(160);

  // Two writes the server can't reach: waiting.
  await context.route("**/api/sync/push", (route) => route.abort("internetdisconnected"));
  const createdAt = new Date().toISOString();
  await writeLocal(page, "outbox", [
    { id: crypto.randomUUID(), type: "test.unknown", payload: {}, createdAt },
    { id: crypto.randomUUID(), type: "flock.recordDay", payload: { batchId: "0197a3c2-0000-7000-8000-000000000001", day: "2026-11-20", changes: { dead: 3 } }, createdAt },
  ]);
  await page.reload();
  await expect(chip(page)).toHaveAccessibleName("Synchronisation : 2 en attente");
  expect(await width()).toBe(160);

  // No network: said first.
  await context.setOffline(true);
  await expect(chip(page)).toHaveAccessibleName("Synchronisation : Hors ligne");
  expect(await width()).toBe(160);

  // Back online, both are refused: they wait on the user, on /sync.
  await context.unroute("**/api/sync/push");
  await context.setOffline(false);
  await expect(chip(page)).toHaveAccessibleName("Synchronisation : 2 refus à vérifier", { timeout: 30_000 });
  expect(await width()).toBe(160);
  await chip(page).click();
  await page.waitForURL(/\/fr\/sync$/);
  await expect(page.getByRole("heading", { name: "À vérifier" })).toBeVisible();
});
