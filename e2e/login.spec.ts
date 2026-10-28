import { expect, test } from "@playwright/test";
import { Client } from "pg";

// The app's own database (the production build under test reads DATABASE_URL too).
async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

// Better Auth stores the pending code as "<code>:<attempts>".
const codeFor = async (e164: string) =>
  (await query<{ value: string }>(`SELECT value FROM "Verification" WHERE identifier = $1 ORDER BY "createdAt" DESC LIMIT 1`, [e164]))[0]
    .value.split(":")[0];

// A fresh number per run: rate limits persist in the database between runs.
const randomMobile = () => `06${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

test("log in with a phone code, then log out", async ({ page, context }) => {
  const phone = randomMobile();
  const e164 = `+212${phone.slice(1)}`;

  await page.goto("/fr/login");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await page.getByLabel("Code reçu").fill(await codeFor(e164));
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/fr\/account$/);
  await expect(page.getByText(e164)).toBeVisible();

  const sid = (await context.cookies()).find((c) => c.name === "__Secure-sid");
  expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  const [{ n }] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u."phoneNumber" = $1`,
    [e164],
  );
  expect(n).toBe(0);
  await page.goto("/fr/account");
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
