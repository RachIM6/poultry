import { devices, expect, test } from "@playwright/test";

test("after the first visit, the shell reloads offline", async ({ page, context }) => {
  await page.goto("/ar");
  // ready resolves once the worker is active, i.e. after the shell is precached.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  // setOffline alone doesn't cut the service worker's own fetches in Chromium; aborting every request does.
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  const reload = await page.reload();
  expect(reload?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // A page never opened online falls back to the offline page, in its own language.
  await page.goto("/fr/install");
  await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeVisible();
  await page.goto("/ar/install");
  await expect(page.getByRole("heading", { name: "لا يوجد اتصال" })).toBeVisible();
});

// Lighthouse 12 dropped its PWA/installable audit, and Page.getInstallabilityErrors returns [] even without a
// manifest. So: Chrome must find and parse our manifest cleanly, and the next test checks the install fields.
test("Chrome parses the manifest without errors", async ({ page }) => {
  await page.goto("/ar");
  const cdp = await page.context().newCDPSession(page);
  const { url, errors } = await cdp.send("Page.getAppManifest");
  expect(url).toMatch(/\/ar\/manifest\.webmanifest$/);
  expect(errors).toEqual([]);
});

test("each locale links its own manifest, starting on that locale", async ({ page, request }) => {
  await page.goto("/fr");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/fr/manifest.webmanifest");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "DigiAtlas-VOLAILLE", short_name: "DigiAtlas", start_url: "/fr/today", lang: "fr", dir: "ltr", display: "standalone" });
  // Chrome's install criteria: icons of 192 px and 512 px.
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

// The installed app starts on /today (SPEC X1): offline too, and with a way in when nobody has signed in yet.
test("the start screen opens offline and leads a new phone to the login", async ({ page, context }) => {
  await page.goto("/fr/login");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await context.route("**", (route) => route.abort("internetdisconnected"));
  await page.goto("/fr/today");
  await expect(page.getByText("Connectez-vous pour synchroniser ce téléphone.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/fr/login");
});

// poultry-pwa §0.6: a new worker waits for the user's tap, then takes over and the page reloads.
test("a new version waits for the user, then reloads the page", async ({ page }) => {
  await page.goto("/fr/login");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByText("Une nouvelle version de l’application est prête.")).toBeHidden();

  // The next deploy, as the browser sees it: a changed worker script for the same scope. (Playwright can't rewrite the
  // browser's own update check of /serwist/sw.js, so the "new" script is the same one at another URL.)
  await page.evaluate(() => navigator.serviceWorker.register("/serwist/sw.js?next", { scope: "/", type: "module" }));
  await expect(page.getByText("Une nouvelle version de l’application est prête.")).toBeVisible({ timeout: 20_000 });

  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Mettre à jour" }).click();
  await reloaded;
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/serwist\/sw\.js\?next$/);
});

test("the install guide shows Android steps on Android", async ({ page }) => {
  await page.goto("/fr/install");
  await expect(page.getByRole("heading", { name: "Android (Chrome)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "iPhone (Safari)" })).toBeHidden();
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent });

  test("the install guide shows Safari steps", async ({ page }) => {
    await page.goto("/ar/install");
    await expect(page.getByRole("heading", { name: "آيفون (Safari)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "أندرويد (Chrome)" })).toBeHidden();
  });
});
