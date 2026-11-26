import { expect, test } from "@playwright/test";
import { ownerWithFarm } from "./auth";

// Home and the wide sign-in panel (src/components/landing.tsx). The landing page (src/app/[locale]/page.tsx) is off for
// now: next.config.ts redirects home to the login, or to the dashboard with a session.

for (const [locale, dir, title] of [
  ["fr", "ltr", "Connexion"],
  ["ar", "rtl", "تسجيل الدخول"],
] as const) {
  test(`home opens the sign-in (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/login$`));
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(title);
  });
}

test("home opens the dashboard when signed in, and the sign-in when the session is gone", async ({ page, context }) => {
  await ownerWithFarm(page, "Ferme de l’accueil");
  await page.goto("/fr");
  await expect(page).toHaveURL(/\/fr\/dashboard$/);

  // An expired or revoked session still sends its cookie: the dashboard sends it on to the sign-in, with no loop.
  await context.clearCookies();
  await context.addCookies([{ name: "__Secure-sid", value: "expired", domain: "localhost", path: "/", secure: true, sameSite: "Lax" }]);
  await page.goto("/ar");
  await expect(page).toHaveURL(/\/ar\/login$/);
});

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
