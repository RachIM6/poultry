import { expect, test } from "@playwright/test";

test("/ redirects to Arabic, rendered right-to-left", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the switcher moves between Arabic (RTL) and French (LTR) on the same page", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("link", { name: "Français" }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText("Gestion des élevages avicoles")).toBeVisible();

  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("an unknown locale is a 404", async ({ page }) => {
  const response = await page.goto("/de");
  expect(response?.status()).toBe(404);
});
