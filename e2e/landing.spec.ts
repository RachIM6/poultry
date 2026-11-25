import { expect, test } from "@playwright/test";

// The public entry page (src/app/[locale]/page.tsx) and the wide sign-in panel (src/components/landing.tsx).

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

test("sign-in on a wide screen: the brand panel beside the form; on the phone, no panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/fr/login");
  const panel = page.getByRole("complementary");
  const form = page.getByRole("button", { name: "Se connecter", exact: true });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  const [a, b] = [(await panel.boundingBox())!, (await form.boundingBox())!];
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(panel).toBeHidden();
});
