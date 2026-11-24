import { expect, test } from "@playwright/test";
import { codeFor, login, ownerWithFarm, query, randomMobile } from "./auth";

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

// T26: the production build checks the captcha for real (the form above solved one); a bare request is refused.
test("a code request without a solved captcha is refused", async ({ page }) => {
  await page.goto("/fr/login");
  const status = await page.evaluate(() =>
    fetch("/api/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "poultry" },
      body: JSON.stringify({ phone: "0612345678" }),
    }).then((r) => r.status),
  );
  expect(status).toBe(400);
});

// T26: after 3 wrong codes verify-code wants a captcha. The code step solves one and the right code then logs in.
test("after 3 wrong codes, the code step solves a captcha and the right code logs in", async ({ page }) => {
  const phone = randomMobile();
  const e164 = `+212${phone.slice(1)}`;
  await page.goto("/fr/login");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  await page.getByRole("status").waitFor();
  const code = await codeFor(e164);
  const alert = page.getByRole("main").getByRole("alert");
  const send = async (value: string) => {
    await page.getByLabel("Code reçu").fill(value);
    const [res] = await Promise.all([page.waitForResponse("**/api/auth/verify-code"), page.getByRole("button", { name: "Se connecter" }).click()]);
    return res;
  };

  for (let i = 0; i < 3; i++) expect((await send(code === "000000" ? "111111" : "000000")).status()).toBe(401);
  await expect(alert).toHaveText("Code incorrect ou expiré.");

  expect((await send(code)).status()).toBe(400); // no captcha yet: the code isn't even checked
  await expect(alert).toHaveText("La vérification de sécurité a échoué. Réessayez.");

  const res = await send(code); // the click waits for the captcha solved in the browser
  expect(res.request().postDataJSON().captcha).toMatchObject({ challenge: expect.any(Object), solution: expect.any(Object) });
  expect(res.status()).toBe(200);
  await expect(page).toHaveURL(/\/fr\/onboarding$/);
});

// T25 S3: the Content-Security-Policy is sent, and the app itself never trips it.
test("pages send a Content-Security-Policy that the app doesn't violate", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/fr/login");
  expect(res?.headers()["content-security-policy"]).toMatch(/object-src 'none'.*frame-ancestors 'none'/);
  await expect(page.getByRole("button", { name: "Recevoir un code" })).toBeEnabled();
  expect(violations).toEqual([]);
});

// T25 S2: a lost phone. "Déconnecter tous mes appareils" on one phone ends the other phone's session too.
test("log out of all devices ends every session of the user", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const e164 = await ownerWithFarm(page, "Élevage S2");
  const lost = await browser.newPage();
  await login(lost, "fr", `0${e164.slice(4)}`);
  await lost.waitForURL(/\/fr\/dashboard$/);

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // tasks/plan-ui.md U2: the "Plus" tab
  await page.getByRole("button", { name: "Déconnecter tous mes appareils" }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  const [{ n }] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u."phoneNumber" = $1`,
    [e164],
  );
  expect(n).toBe(0);
  await lost.goto("/fr/dashboard");
  await expect(lost).toHaveURL(/\/fr\/login$/);
  await lost.close();
});
