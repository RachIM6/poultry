import { expect, test, type Locator, type Page } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";
import { orgOf } from "./screens";

// tasks/plan-ui.md U19 (Menu4.dc.html, Menu4b.dc.html): on a wide screen the sidebar is unfolded (288 px, the « Plus »
// groups as collapsible headings) or folded to a 72 px rail (a group's icon opens its links in a side panel), remembered
// on this browser and applied before the first paint. The phone keeps its « Plus » tab and the /more page.
const WIDE = { width: 1440, height: 900 };
const nav = (page: Page, name = "Navigation principale") => page.getByRole("navigation", { name });
const width = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().width);
const phoneRole = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        const req = indexedDB.open("poultry-device");
        req.onsuccess = () => {
          const get = req.result.transaction("session").objectStore("session").get("current");
          get.onsuccess = () => (req.result.close(), resolve(get.result?.scope?.role));
        };
      }),
  );
/** SPEC X4: every link and button of the nav at least 44 px tall, no label cut (they never wrap), none pushed out. */
const fits = (scope: Locator) =>
  scope.evaluate((root) => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll("a, button")]
      .filter((el) => el.checkVisibility())
      .flatMap((el) => {
        const r = el.getBoundingClientRect();
        const cut = r.height < 43.5 || el.scrollWidth > el.clientWidth + 1 || r.left < box.left - 1 || r.right > box.right + 1;
        return cut ? [`${el.textContent || el.getAttribute("aria-label")}: ${r.left}–${r.right} × ${r.height}, ${el.scrollWidth} wide`] : [];
      });
  });
const GROUPS = ["Élevage", "Argent", "Comptabilité de l’exercice", "Conformité"];
/**
 * U20: whole, in view and on top (nothing over its top, middle or bottom), so the sticky « Replier le menu » never
 * covers it, scrolled to the end at any height.
 */
const uncovered = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const nav = el.closest("nav")!.getBoundingClientRect();
    const onTop = [r.top + 2, r.top + r.height / 2, r.bottom - 2].every((y) => el.contains(document.elementFromPoint(r.x + r.width / 2, y)));
    return r.top >= nav.top && r.bottom <= Math.min(innerHeight, nav.bottom) && onTop;
  });

test("wide screens, unfolded: the role's groups open under their headings and mark the current page", async ({ page }) => {
  test.setTimeout(180_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Barre");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.goto("/fr/dashboard");

  // The default on a first visit: unfolded, no « Plus » any more.
  const fold = nav(page).getByRole("button", { name: "Replier le menu" });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  expect(await width(nav(page))).toBe(288);
  await expect(nav(page).getByRole("link", { name: "Plus", exact: true })).toBeHidden();
  await expect(nav(page).getByRole("button", { name: "Plus" })).toHaveCount(0);

  const heading = (name: string) => nav(page).getByRole("heading", { name }).getByRole("button");
  for (const name of GROUPS) await expect(heading(name)).toHaveAttribute("aria-expanded", "false");
  const treasury = nav(page).getByRole("link", { name: "Trésorerie" });
  await expect(treasury).toBeHidden();

  // The keyboard opens them, several at once.
  await heading("Argent").press("Enter");
  await heading("Conformité").press(" ");
  for (const name of ["Argent", "Conformité"]) await expect(heading(name)).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("list", { name: "Argent" }).getByRole("link", { name: "Trésorerie" })).toBeVisible();
  await expect(nav(page).getByRole("list", { name: "Conformité" }).getByRole("link", { name: "Registre des visiteurs" })).toBeVisible();
  const account = nav(page).getByRole("list", { name: "Compte" });
  // U20: the language and the sign-out are in the header's menu; « Mes exploitations » is the last link.
  await expect(account.getByRole("link")).toHaveText(["Membres", "Mes exploitations"]);
  // tasks/plan-ui-cleanup.md §3: the notifications and the sync are the header's bell and chip on wide screens.
  for (const name of ["Notifications", "Synchronisation"]) await expect(nav(page).getByRole("link", { name })).toHaveCount(0);

  // Every group open: 44 px targets, no label cut at 288 px (« Cadavres, fumier et nuisibles », « Clôture de l’exercice »).
  for (const name of ["Élevage", "Comptabilité de l’exercice"]) await heading(name).click();
  expect(await fits(nav(page))).toEqual([]);
  // One entry per topic, its other pages as the page's tabs: 25 links in the groups, not 34.
  const counts = { Élevage: 8, Argent: 4, "Comptabilité de l’exercice": 6, Conformité: 5, Compte: 2 };
  for (const [name, n] of Object.entries(counts)) await expect(nav(page).getByRole("list", { name }).getByRole("link"), name).toHaveCount(n);
  await expect(nav(page).locator("ul[aria-labelledby] a")).toHaveCount(25);
  await expect(nav(page).getByRole("list", { name: "Comptabilité de l’exercice" }).getByRole("link")).toHaveText([
    "Livres comptables", "Résultats et budget", "Clôture de l’exercice", "Immobilisations", "Emprunts et subventions", "Paramètres comptables",
  ]);
  // The sidebar scrolls on its own: the page doesn't move with it.
  expect(await nav(page).evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);
  // « Replier le menu » stays pinned at its foot, whole and on top, at either end of the scroll; nothing ends up under it.
  const onTop = (l: Locator) =>
    l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
  expect(await onTop(fold)).toBe(true);
  const farms = account.getByRole("link", { name: "Mes exploitations" });
  for (const size of [WIDE, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await nav(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await onTop(fold), `${size.width}×${size.height}`).toBe(true);
    expect(await uncovered(farms), `${size.width}×${size.height}`).toBe(true);
  }
  await page.setViewportSize(WIDE);
  await nav(page).evaluate((el) => el.scrollTo(0, 0));

  await treasury.click();
  await page.waitForURL(/\/fr\/treasury$/);
  await expect(treasury).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main").getByRole("link", { name: "Retour" })).toBeHidden(); // owner feedback: no back to the /more page
  // Closed, the group holding the current page shows a dot.
  await heading("Argent").click();
  await expect(heading("Argent")).toHaveAttribute("aria-current", "true");
  await expect(heading("Argent").locator(".rounded-full")).toBeVisible();

  // Loaded straight on a page: its group opens; a merged entry is current on every page of its tabs, the one entry so.
  await page.goto("/fr/closing/count");
  await expect(heading("Comptabilité de l’exercice")).toHaveAttribute("aria-expanded", "true");
  await expect(heading("Argent")).toHaveAttribute("aria-expanded", "false");
  await expect(nav(page).getByRole("link", { name: "Clôture de l’exercice" })).toHaveAttribute("href", "/fr/closing/count"); // step 1
  const merged: [string, string, string][] = [
    ["/fr/closing/count", "Comptabilité de l’exercice", "Clôture de l’exercice"],
    ["/fr/closing", "Comptabilité de l’exercice", "Clôture de l’exercice"],
    ["/fr/closing/statements", "Comptabilité de l’exercice", "Clôture de l’exercice"],
    ["/fr/treasury/bank", "Argent", "Trésorerie"],
    ["/fr/budget", "Comptabilité de l’exercice", "Résultats et budget"],
    ["/fr/threshold", "Comptabilité de l’exercice", "Résultats et budget"],
    ["/fr/settings/chart", "Comptabilité de l’exercice", "Paramètres comptables"],
    ["/fr/settings/posting", "Comptabilité de l’exercice", "Paramètres comptables"],
    ["/fr/climate/targets", "Élevage", "Climat des bâtiments"],
  ];
  for (const [path, group, name] of merged) {
    if (page.url() !== `${new URL(page.url()).origin}${path}`) await page.goto(path);
    await expect(heading(group), path).toHaveAttribute("aria-expanded", "true");
    await expect(nav(page).getByRole("link", { name }), path).toHaveAttribute("aria-current", "page");
    await expect(nav(page).locator("ul[aria-labelledby] a[aria-current]"), path).toHaveCount(1);
  }

  // A worker never sees the money screens (I5); the phone forgets the role's links with the role.
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  await expect.poll(() => phoneRole(page)).toBe("worker");
  await page.goto("/fr/dashboard");
  await expect(heading("Élevage")).toBeVisible();
  await heading("Élevage").click();
  await expect(nav(page).getByRole("link", { name: "Fermes et bâtiments" })).toBeVisible();
  for (const name of ["Trésorerie", "Livres comptables", "Créances des acheteurs", "Membres"]) await expect(nav(page).getByRole("link", { name })).toHaveCount(0);
  for (const name of ["Argent", "Comptabilité de l’exercice"]) await expect(nav(page).getByRole("heading", { name })).toHaveCount(0);
});

test("wide screens, folded: a 72 px rail whose group icons open a side panel, remembered without a shift", async ({ page }) => {
  test.setTimeout(180_000);
  const e164 = await ownerWithFarm(page, "Élevage du Rail");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.goto("/fr/dashboard");

  await nav(page).getByRole("button", { name: "Replier le menu" }).click();
  const unfold = nav(page).getByRole("button", { name: "Déplier le menu" });
  await expect(unfold).toHaveAttribute("aria-expanded", "false");
  await expect(unfold).toBeFocused(); // the same button, its name changed
  expect(await width(nav(page))).toBe(72);
  await expect(nav(page).getByRole("heading", { name: "Argent" })).toHaveCount(0); // no headings: icons

  // Icons named, 48 px, with a tooltip on hover and on keyboard focus.
  const icon = (name: string) => nav(page).getByRole("button", { name, exact: true });
  for (const name of [...GROUPS, "Compte"]) expect(await width(icon(name))).toBe(48);
  const tip = (l: Locator) => l.locator("[data-tip]").evaluate((el) => getComputedStyle(el).opacity);
  expect(await tip(icon("Argent"))).toBe("0");
  await icon("Argent").hover();
  await expect.poll(() => tip(icon("Argent"))).toBe("1");
  await nav(page).getByRole("link", { name: "Stock" }).focus();
  await page.keyboard.press("Tab"); // the next stop after the tabs: the first group
  await expect(icon("Élevage")).toBeFocused();
  await expect.poll(() => tip(icon("Élevage"))).toBe("1");

  // A group's icon opens its panel, which widens the sidebar; the same icon closes it.
  const books = icon("Comptabilité de l’exercice");
  await books.press("Enter");
  await expect(books).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`#${await books.getAttribute("aria-controls")}`);
  await expect(panel.getByRole("heading", { name: "Comptabilité de l’exercice" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Comptabilité de l’exercice" }).getByRole("link", { name: "Livres comptables" })).toBeVisible();
  expect(await width(nav(page))).toBe(328);
  expect(await width(panel)).toBe(256);
  expect(await fits(panel)).toEqual([]);
  await books.click();
  await expect(panel).toBeHidden();
  expect(await width(nav(page))).toBe(72);
  // Escape closes it from inside, the focus back on its icon; so does « Fermer le panneau ».
  await books.click();
  await panel.getByRole("link", { name: "Livres comptables" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(books).toBeFocused();
  await icon("Compte").click();
  const accountPanel = page.locator(`#${await icon("Compte").getAttribute("aria-controls")}`);
  await expect(accountPanel.getByRole("link")).toHaveText(["Membres", "Mes exploitations"]); // U20: no « Langue et déconnexion »
  await accountPanel.getByRole("button", { name: "Fermer le panneau" }).click();
  await expect(accountPanel).toBeHidden();
  await expect(icon("Compte")).toBeFocused();
  // The rail's last icon is never under « Déplier le menu », scrolled to the end, even where the rail scrolls (< 640 px).
  for (const size of [{ width: 1280, height: 720 }, { width: 1280, height: 600 }, WIDE]) {
    await page.setViewportSize(size);
    await nav(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await uncovered(icon("Compte")), `${size.width}×${size.height}`).toBe(true);
  }
  // One panel at a time: another icon replaces it.
  await books.click();
  await icon("Argent").click();
  await expect(panel).toBeHidden();
  for (const p of await nav(page).locator("[data-panel]:visible").all()) expect(await fits(p)).toEqual([]);

  // A link in the panel: the page is marked in it, and its group's icon on the rail.
  await nav(page).getByRole("link", { name: "Trésorerie" }).click();
  await page.waitForURL(/\/fr\/treasury$/);
  await expect(nav(page).getByRole("link", { name: "Trésorerie" })).toHaveAttribute("aria-current", "page");
  await expect(icon("Argent")).toHaveAttribute("aria-current", "true");
  await expect(icon("Conformité")).not.toHaveAttribute("aria-current", /./);

  // Remembered on this browser, and laid out before the first paint: the rail is 72 px from the start, nothing shifts.
  await page.addInitScript(() => {
    const w = window as unknown as { shifts: number; navAtStart?: number };
    w.shifts = 0;
    new PerformanceObserver((list) => list.getEntries().forEach((e) => (w.shifts += (e as unknown as { value: number }).value))).observe({ type: "layout-shift", buffered: true });
    document.addEventListener("DOMContentLoaded", () => (w.navAtStart = document.querySelector('nav[aria-label="Navigation principale"]')?.getBoundingClientRect().width));
  });
  await page.goto("/fr/closing/count", { waitUntil: "load" });
  await expect(icon("Comptabilité de l’exercice")).toHaveAttribute("aria-current", "true");
  await expect(unfold).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { navAtStart: number }).navAtStart)).toBe(72);
  expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBe(0);
  await expect(nav(page).locator("[data-panel]:visible")).toHaveCount(0); // a panel opens only when asked
  // A merged entry: its group's icon and, in the panel, the entry itself are current on any page of its tabs.
  for (const [path, name] of [["/fr/closing/statements", "Clôture de l’exercice"], ["/fr/settings/posting", "Paramètres comptables"]]) {
    await page.goto(path);
    await expect(icon("Comptabilité de l’exercice"), path).toHaveAttribute("aria-current", "true");
    await icon("Comptabilité de l’exercice").click();
    await expect(nav(page).locator("[data-panel]:visible").getByRole("link", { name }), path).toHaveAttribute("aria-current", "page");
  }

  // A worker's rail has no money icons either.
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  await expect.poll(() => phoneRole(page)).toBe("worker");
  await page.goto("/fr/dashboard");
  await expect(icon("Élevage")).toBeVisible();
  for (const name of ["Argent", "Comptabilité de l’exercice"]) await expect(icon(name)).toHaveCount(0);

  // Unfolded again, remembered too.
  await unfold.click();
  expect(await width(nav(page))).toBe(288);
  await page.reload();
  await expect(nav(page).getByRole("button", { name: "Replier le menu" })).toBeVisible();
});

test("wide screens in Arabic: the sidebar on the right, the rail's panel to its left, no label cut", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage de l’Est");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.goto("/ar/dashboard");
  const sidebar = nav(page, "القائمة الرئيسية");

  const headings = sidebar.getByRole("heading").getByRole("button");
  await expect(headings).toHaveCount(4);
  for (const b of await headings.all()) if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
  expect(await fits(sidebar)).toEqual([]);
  const box = (await sidebar.boundingBox())!;
  expect(box.x + box.width).toBe(WIDE.width);

  await sidebar.getByRole("button", { name: "طي القائمة" }).click();
  const ids = await sidebar.getByRole("list").nth(1).getByRole("button").evaluateAll((all) => all.map((b) => b.getAttribute("aria-controls")!));
  expect(ids).toHaveLength(4);
  for (const id of ids) {
    const b = sidebar.locator(`[aria-controls="${id}"]`);
    await b.click();
    const panel = page.locator(`#${id}`);
    expect(await fits(panel)).toEqual([]);
    const [p, rail] = [(await panel.boundingBox())!, (await b.boundingBox())!];
    expect(p.x + p.width).toBeLessThanOrEqual(rail.x); // to the rail's left
  }
});

test("the phone: the « Plus » tab still opens /more, the notifications and the sync under « Compte »", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage du Pouce");
  await scopeRemembered(page);
  await expect(nav(page).getByRole("button", { name: "Replier le menu" })).toBeHidden();
  await expect(nav(page).getByRole("button", { name: "Argent" })).toBeHidden();
  await nav(page).getByRole("link", { name: "Plus", exact: true }).click();
  await page.waitForURL(/\/fr\/more$/);
  await expect(page.getByRole("heading", { name: "Plus", level: 1 })).toBeVisible();
  // The sidebar's 25 entries, and the two the wide header holds (tasks/plan-ui-cleanup.md §3).
  const more = page.getByRole("main");
  await expect(more.getByRole("region", { name: "Compte" }).getByRole("link")).toHaveText(["Membres", "Mes exploitations", "Notifications", "Synchronisation"]);
  await expect(more.getByRole("link")).toHaveCount(27);
  await expect(more.getByRole("link", { name: "Clôture de l’exercice" })).toHaveAttribute("href", "/fr/closing/count");
  await page.getByRole("main").getByRole("link", { name: "Trésorerie" }).click();
  await page.getByRole("main").getByRole("link", { name: "Retour" }).click(); // the phone's way back to « Plus »
  await page.waitForURL(/\/fr\/more$/);
});
