import { expect, test, type Page } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";
import { orgOf } from "./screens";

// tasks/plan-ui.md U20: one header bar on every signed-in screen, its controls at the end (left in Arabic): the bell to
// the notifications, then the profile (avatar, name, role) opening the account menu (names, farms, language, sign-out).
const WIDE = { width: 1440, height: 900 };
const profile = (page: Page) => page.getByRole("banner").locator("button[aria-controls]");
const menu = (page: Page) => profile(page).locator("xpath=following-sibling::div[1]"); // the panel it controls
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
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Notifications" }), path).toBeVisible();
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

  // The bell leads to the notifications.
  await page.getByRole("banner").getByRole("link", { name: "Notifications" }).click();
  await page.waitForURL(/\/fr\/inbox$/);

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
  const bell = (await page.getByRole("banner").getByRole("link", { name: "الإشعارات" }).boundingBox())!;
  expect(bell.x).toBeGreaterThan(button.x + button.width - 1); // then the bell, after the profile
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
    await expect(page.getByRole("banner").getByRole("link", { name: "Notifications" }), path).toBeVisible();
    await expect(profile(page), path).toHaveAccessibleName("Nadia Testeur Propriétaire");
    const box = (await profile(page).boundingBox())!;
    expect(box.width).toBe(44); // the avatar only; the name is in the menu
  }
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
