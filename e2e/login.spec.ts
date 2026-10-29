import { expect, test } from "@playwright/test";
import { login, query, randomMobile } from "./auth";

test("log in with a phone code, then log out", async ({ page, context }) => {
  const e164 = await login(page, "fr");
  await expect(page).toHaveURL(/\/fr\/onboarding$/); // a new number has no organisation yet

  const sid = (await context.cookies()).find((c) => c.name === "__Secure-sid");
  expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  const [{ n }] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u."phoneNumber" = $1`,
    [e164],
  );
  expect(n).toBe(0);
  await page.goto("/fr/dashboard");
  await expect(page).toHaveURL(/\/fr\/login$/);
});

test("a wrong code shows a translated error (Arabic)", async ({ page }) => {
  await page.goto("/ar/login");
  await page.getByLabel("رقم الهاتف").fill(randomMobile());
  await page.getByRole("button", { name: "استلام الرمز" }).click();
  await page.getByLabel("الرمز المستلم").fill("000000");
  await page.getByRole("button", { name: "دخول" }).click();
  // Scoped to <main>: Next's route announcer is also role="alert".
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("الرمز غير صحيح أو منتهي الصلاحية.");
});

test("auth endpoints refuse cross-site requests (CSRF)", async ({ request }) => {
  const res = await request.post("/api/auth/request-code", { data: { phone: "0612345678" } });
  expect(res.status()).toBe(403);
});
