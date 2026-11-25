import { devices, expect, test, type Page } from "@playwright/test";

// The install page (src/components/install-guide.tsx). Playwright can't open Chrome's real install dialog, nor make
// headless Chromium fire beforeinstallprompt on its own: these tests dispatch a stand-in event, the way Chrome would,
// and check the page keeps it, prompts with it and follows the user's choice. Installing for real is checked by hand.

/** Console errors and uncaught exceptions while the test runs. */
function errorsOf(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Chrome's install offer, as the page sees it: window.prompted counts prompt() calls. */
function offerInstall(page: Page, outcome: "accepted" | "dismissed") {
  return page.evaluate((outcome) => {
    const w = window as unknown as { prompted: number };
    w.prompted = 0;
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => Promise.resolve(void w.prompted++),
      userChoice: Promise.resolve({ outcome }),
    });
    dispatchEvent(event);
    return event.defaultPrevented;
  }, outcome);
}

test("without an install offer, Android's steps come first and the others fold away", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/fr/install");
  await expect(page.getByRole("heading", { level: 1, name: "Installer l'application" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Suivez les étapes pour votre appareil.");
  await expect(page.getByRole("heading", { name: "Android (Chrome)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Installer l'application" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "iPhone et iPad (Safari)" })).toBeHidden();

  await page.getByText("Autres appareils").click();
  await expect(page.getByRole("heading", { name: "iPhone et iPad (Safari)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordinateur (Chrome ou Edge)" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Chrome's install offer becomes a button that opens its dialog", async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto("/fr/install");
  expect(await offerInstall(page, "accepted")).toBe(true); // kept for the button, not shown by Chrome itself

  const button = page.getByRole("button", { name: "Installer l'application" });
  await expect(button).toBeVisible();
  await expect(page.getByRole("heading", { name: "Android (Chrome)" })).toBeHidden(); // folded under "Autres appareils"
  await button.click();
  expect(await page.evaluate(() => (window as unknown as { prompted: number }).prompted)).toBe(1);
  await expect(page.getByRole("status")).toHaveText("L'application est installée sur cet appareil.");
  await expect(page.getByRole("link", { name: "Ouvrir l'application" })).toHaveAttribute("href", "/fr/today");
  await expect(button).toBeHidden();
  expect(errors).toEqual([]);
});

test("an offer made before the page hydrates is kept too", async ({ page }) => {
  // DOMContentLoaded: after the layout's inline script, before React has necessarily hydrated the page.
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () =>
      dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: "accepted" }) })),
    ),
  );
  await page.goto("/fr/install");
  await expect(page.getByRole("button", { name: "Installer l'application" })).toBeVisible();
});

test("a dismissed dialog leaves the steps, and says so", async ({ page }) => {
  await page.goto("/ar/install");
  await expect(page.getByRole("status")).toHaveText("اتبع الخطوات الخاصة بجهازك.");
  await offerInstall(page, "dismissed");
  await page.getByRole("button", { name: "تثبيت التطبيق" }).click();
  await expect(page.getByRole("status")).toHaveText("أُلغي التثبيت. يمكنك إتمامه لاحقًا باتباع الخطوات أدناه.");
  await expect(page.getByRole("heading", { name: "أندرويد (Chrome)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toBeHidden();
});

test("opened from the installed app, it says so and links to the start screen", async ({ page }) => {
  // Safari's flag for a home-screen app (Playwright can't emulate display-mode: standalone).
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }));
  await page.goto("/fr/install");
  await expect(page.getByRole("status")).toHaveText("L'application est installée sur cet appareil.");
  await expect(page.getByRole("link", { name: "Ouvrir l'application" })).toHaveAttribute("href", "/fr/today");
  await expect(page.getByRole("heading", { name: "Android (Chrome)" })).toBeHidden();
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent });

  test("Safari's steps come first", async ({ page }) => {
    const errors = errorsOf(page);
    await page.goto("/ar/install");
    await expect(page.getByRole("heading", { name: "آيفون وآيباد (Safari)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "أندرويد (Chrome)" })).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe("in Firefox on a computer", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0" });

  test("it says Firefox can't install, and shows the Chrome or Edge steps", async ({ page }) => {
    await page.goto("/fr/install");
    await expect(page.getByText("Firefox ne permet pas d'installer une application web sur ordinateur.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ordinateur (Chrome ou Edge)" })).toBeVisible();
  });
});
