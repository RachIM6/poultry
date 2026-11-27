import { expect, test } from "@playwright/test";

// tasks/plan-ui-cleanup.md batch 0: the shared tabs, pager and sheet, on the e2e-only /ui-kit page
// (src/app/[locale]/(app)/ui-kit), and the service worker's rule that a shell's ?tab= and ?page= open it offline.
const WIDE = { width: 1440, height: 900 };

test("tabs are links: the URL says which, back returns to the previous one, an unknown tab is the first", async ({ page }) => {
  await page.goto("/fr/ui-kit");
  const tabs = page.getByRole("navigation", { name: "Onglets" });
  await expect(tabs.getByRole("link", { name: /Onglet 1/ })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Onglet 2" }).click();
  await expect(page).toHaveURL(/\/fr\/ui-kit\?tab=two$/);
  await expect(tabs.getByRole("link", { name: "Onglet 2" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: /Onglet 1/ })).not.toHaveAttribute("aria-current");
  await expect(page.getByRole("region", { name: "Onglet 2" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/fr\/ui-kit$/);
  await expect(page.getByRole("region", { name: "Onglet 1" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("region", { name: "Onglet 2" })).toBeVisible();
  await page.goto("/fr/ui-kit?tab=nope");
  await expect(tabs.getByRole("link", { name: /Onglet 1/ })).toHaveAttribute("aria-current", "page");
});

test("the pager: a range, numbered links that keep the tab, no link past either end", async ({ page }) => {
  await page.goto("/fr/ui-kit");
  const pager = page.getByRole("navigation", { name: "Pagination" });
  await expect(pager).toContainText("1–25 sur 132");
  await expect(pager.getByRole("link", { name: "Précédent" })).toHaveCount(0);
  await expect(pager.getByRole("link", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await pager.getByRole("link", { name: "Page 2" }).click();
  await expect(page).toHaveURL(/\?tab=one&page=2$/);
  await expect(pager).toContainText("26–50 sur 132");
  await expect(page.getByRole("cell", { name: "Ligne 26", exact: true })).toBeVisible();
  await pager.getByRole("link", { name: "Suivant" }).click();
  await expect(page).toHaveURL(/page=3$/);
  await expect(pager.getByRole("link", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  await pager.getByRole("link", { name: "Page 6" }).click();
  await expect(pager).toContainText("126–132 sur 132");
  await expect(pager.getByRole("link", { name: "Suivant" })).toHaveCount(0);
  await page.goBack();
  await expect(pager).toContainText("51–75 sur 132");
  await page.goto("/fr/ui-kit?page=99"); // past the end: the last page
  await expect(pager).toContainText("126–132 sur 132");
});

test("the sheet: first field focused, Tab stays inside, Escape and « Fermer » close it, the focus goes back to its button", async ({ page }) => {
  await page.goto("/fr/ui-kit");
  const opener = page.getByRole("button", { name: "Ajouter une ligne" });
  const sheet = page.getByRole("dialog", { name: "Nouvelle ligne" });
  await opener.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Libellé")).toBeFocused();
  // The page behind is inert: Tab cycles through the sheet's controls only (the browser's own UI may take a turn).
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter"); // the focused opener, from the keyboard
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await sheet.getByLabel("Libellé").fill("Test");
  await sheet.getByRole("button", { name: "Enregistrer" }).click(); // the form closes its sheet once saved
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the sheet comes up from the bottom on the phone and from the end side on a wide screen, in both directions", async ({ page }) => {
  await page.goto("/fr/ui-kit");
  const sheet = page.getByRole("dialog", { name: "Nouvelle ligne" });
  const viewport = page.viewportSize()!;
  await page.getByRole("button", { name: "Ajouter une ligne" }).click();
  let box = (await sheet.boundingBox())!;
  expect([Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)]).toEqual([0, viewport.width, viewport.height]);
  await page.keyboard.press("Escape");

  await page.setViewportSize(WIDE);
  for (const [locale, atEnd] of [["fr", true], ["ar", false]] as const) {
    await page.goto(`/${locale}/ui-kit`);
    await page.getByRole("button", { name: "Ajouter une ligne" }).click();
    box = (await sheet.boundingBox())!;
    expect(Math.round(box.width)).toBe(448); // 28rem
    expect(Math.round(box.height)).toBe(WIDE.height);
    expect(Math.round(atEnd ? box.x + box.width : box.x)).toBe(atEnd ? WIDE.width : 0);
    await page.keyboard.press("Escape");
  }
});

test("a precached shell opens offline with ?tab= and ?page=", async ({ page, context }) => {
  await page.goto("/fr/batches");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shells precached
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const offline = await page.goto("/fr/batches?tab=sante&page=2");
  expect(offline?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toHaveCount(0);
  await expect(page.getByText("Connectez-vous pour synchroniser ce téléphone.")).toBeVisible(); // the batches shell, nobody signed in
  await page.goto("/fr/batches?other=1"); // any other parameter is another URL: not precached
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeVisible();
});
