import { expect, test, type Page } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";
import { orgOf } from "./screens";

// Owner feedback: on a wide screen « Plus » opens in the sidebar, like a collapsible section, instead of leading to
// /more. The phone keeps its « Plus » tab and the /more page.
const WIDE = { width: 1440, height: 900 };
const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });
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

test("wide screens: « Plus » expands in the sidebar, shows the role's screens and marks the current one", async ({ page }) => {
  test.setTimeout(120_000);
  const e164 = await ownerWithFarm(page, "Élevage de la Barre");
  await scopeRemembered(page);
  await page.setViewportSize(WIDE);
  await page.goto("/fr/dashboard");

  const plus = nav(page).getByRole("button", { name: "Plus" });
  await expect(plus).toHaveAttribute("aria-expanded", "false");
  await expect(nav(page).getByRole("link", { name: "Plus", exact: true })).toBeHidden(); // the button replaces the link
  const treasury = nav(page).getByRole("link", { name: "Trésorerie" });
  await expect(treasury).toBeHidden();

  await plus.press("Enter"); // the keyboard opens it
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  const panel = page.locator(`#${await plus.getAttribute("aria-controls")}`);
  await expect(panel.getByRole("heading", { name: "Argent" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Argent" }).getByRole("link", { name: "Trésorerie" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Langue et déconnexion" })).toHaveAttribute("href", "/fr/more"); // /more's language and sign-out
  for (const h of await panel.getByRole("link").evaluateAll((all) => all.map((a) => a.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(43.5); // SPEC X4: 44 px targets

  await treasury.click();
  await page.waitForURL(/\/fr\/treasury$/);
  await expect(treasury).toHaveAttribute("aria-current", "page");
  await expect(plus).toHaveAttribute("aria-expanded", "true");

  // Loaded straight on a page of the section: open, with only the deepest match current (/closing/count, not /closing).
  await plus.click(); // closed, and remembered…
  await page.goto("/fr/closing/count");
  await expect(plus).toHaveAttribute("aria-expanded", "true"); // …but the current page's section opens
  await expect(nav(page).getByRole("link", { name: "Inventaire de fin d’exercice" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "Préparer la clôture" })).not.toHaveAttribute("aria-current", "page");
  await page.goto("/fr/dashboard");
  await expect(plus).toHaveAttribute("aria-expanded", "false");

  // The sidebar scrolls on its own: the page doesn't move with it.
  await plus.click();
  const sidebar = nav(page);
  expect(await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);

  // A worker never sees the money screens (I5); the phone forgets the role's links with the role.
  await query(`UPDATE "Membership" SET role = 'worker' WHERE "organizationId" = ${orgOf}`, [e164]);
  await page.goto("/fr/dashboard");
  await expect.poll(() => phoneRole(page)).toBe("worker");
  await page.goto("/fr/dashboard");
  await expect(plus).toHaveAttribute("aria-expanded", "true"); // still remembered open
  await expect(nav(page).getByRole("link", { name: "Fermes et bâtiments" })).toBeVisible();
  for (const name of ["Trésorerie", "Comptabilité", "Créances des acheteurs", "Membres"]) await expect(nav(page).getByRole("link", { name })).toHaveCount(0);
  await expect(nav(page).getByRole("heading", { name: "Argent" })).toHaveCount(0);
});

test("the phone: the « Plus » tab still opens /more", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage du Pouce");
  await scopeRemembered(page);
  await expect(nav(page).getByRole("button", { name: "Plus" })).toBeHidden();
  await nav(page).getByRole("link", { name: "Plus", exact: true }).click();
  await page.waitForURL(/\/fr\/more$/);
  await expect(page.getByRole("heading", { name: "Plus", level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Trésorerie" })).toBeVisible();
});
