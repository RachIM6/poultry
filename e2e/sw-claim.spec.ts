import { expect, test } from "@playwright/test";

// clients.claim() skips a page whose navigation is still in flight: one that started while the first install ran and
// commits after the worker activated stayed uncontrolled until its next full load, and offline its next chunk failed.
// PwaProvider asks the worker to claim it (src/sw.ts).
test("a page still loading when the worker activates ends up controlled", async ({ page, context }) => {
  let releaseInstall = () => {};
  const installHeld = new Promise<void>((resolve) => (releaseInstall = resolve));
  // The worker's own precache download of the offline page: the install waits for it.
  await context.route((url) => url.pathname === "/fr/offline", async (route) => (await installHeld, route.continue()));
  await page.goto("/fr/login");
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.installing))).toBe(true);
  const other = await context.newPage(); // loaded before the worker activates: its claim covers this one
  await other.goto("/fr/login");

  let releasePage = () => {};
  const pageHeld = new Promise<void>((resolve) => (releasePage = resolve));
  const requested = new Promise<void>((resolve) => void page.route("**/fr/install", async (route) => (resolve(), await pageHeld, route.continue())));
  const navigation = page.goto("/fr/install");
  await requested; // sent without a worker: none was active yet
  releaseInstall();
  await expect.poll(() => other.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true); // activated, claimed
  releasePage();
  await navigation;

  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});
