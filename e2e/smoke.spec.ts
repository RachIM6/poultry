import { expect, test } from "@playwright/test";

test("/ redirects to Arabic, rendered right-to-left", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("DigiAtlas-VOLAILLE"); // the Latin wordmark, no Arabic name yet
});

test("the switcher moves between Arabic (RTL) and French (LTR) on the same page", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("link", { name: "Français" }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText("L’élevage avicole, jour après jour.")).toBeVisible();

  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("an unknown locale is a 404", async ({ page }) => {
  const response = await page.goto("/de");
  expect(response?.status()).toBe(404);
});

test("an unknown page says so in the page's language, with a way home", async ({ page }) => {
  for (const [path, dir, title, home] of [
    ["/fr/nulle-part", "ltr", "Page introuvable", "Retour à l’accueil"],
    ["/ar/batches/nowhere", "rtl", "الصفحة غير موجودة", "العودة إلى الرئيسية"],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await page.getByRole("link", { name: home }).click();
    await expect(page).toHaveURL(new RegExp(`/${path.slice(1, 3)}$`));
  }
});
