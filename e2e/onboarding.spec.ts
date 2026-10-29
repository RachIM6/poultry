import { expect, test } from "@playwright/test";
import { login, query } from "./auth";

test("a new owner onboards in French and lands on an empty dashboard", async ({ page }) => {
  const e164 = await login(page, "fr");
  await expect(page).toHaveURL(/\/fr\/onboarding$/);

  await page.getByLabel("Nom de l’exploitation ou raison sociale").fill("Ferme El Kheir");
  await page.getByLabel("Indivision (exploitation familiale)").check();
  await page.getByRole("button", { name: "Créer" }).click();

  await expect(page).toHaveURL(/\/fr\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Ferme El Kheir" })).toBeVisible();
  await expect(page.getByText("Aucune ferme pour l’instant.")).toBeVisible();

  const [row] = await query<{ form: string; locale: string; role: string }>(
    `SELECT e.form, u.locale, m.role FROM "User" u JOIN "Membership" m ON m."userId" = u.id
     JOIN "LegalEntity" e ON e."organizationId" = m."organizationId" WHERE u."phoneNumber" = $1`,
    [e164],
  );
  expect(row).toEqual({ form: "indivision", locale: "fr", role: "owner" });

  await page.goto("/fr/onboarding"); // done once: back to the dashboard
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
});

test("onboarding in Arabic saves Arabic as the user's language", async ({ page }) => {
  const e164 = await login(page, "ar");
  await expect(page).toHaveURL(/\/ar\/onboarding$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByLabel("اسم الاستغلالية أو الاسم التجاري").fill("ضيعة الخير");
  await page.getByLabel("تعاونية").check();
  await page.getByRole("button", { name: "إنشاء" }).click();

  await expect(page).toHaveURL(/\/ar\/dashboard$/);
  await expect(page.getByRole("heading", { name: "ضيعة الخير" })).toBeVisible();
  await expect(page.getByText("لا توجد أي ضيعة بعد.")).toBeVisible();
  const [{ locale }] = await query<{ locale: string }>(`SELECT locale FROM "User" WHERE "phoneNumber" = $1`, [e164]);
  expect(locale).toBe("ar");
});

test("the onboarding endpoint refuses cross-site and signed-out requests", async ({ request, baseURL }) => {
  const data = { name: "X", form: "company", locale: "fr" };
  expect((await request.post("/api/onboarding", { data })).status()).toBe(403);
  const sameOrigin = { origin: baseURL!, "x-requested-with": "poultry" };
  expect((await request.post("/api/onboarding", { data, headers: sameOrigin })).status()).toBe(401);
});
