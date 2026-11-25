import { expect, test } from "@playwright/test";

// The public entry page (src/app/[locale]/page.tsx).

for (const [locale, dir, signup, login] of [
  ["fr", "ltr", "Créer un compte", "Se connecter"],
  ["ar", "rtl", "إنشاء حساب", "تسجيل الدخول"],
] as const) {
  test(`the landing page has its title and the ways in (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("DigiAtlas-VOLAILLE");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: signup, exact: true }).first()).toHaveAttribute("href", `/${locale}/signup`);
    await expect(main.getByRole("link", { name: login, exact: true }).first()).toHaveAttribute("href", `/${locale}/login`);
    await main.getByRole("link", { name: signup, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/signup$`));
  });
}

