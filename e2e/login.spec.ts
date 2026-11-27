import { expect, test } from "@playwright/test";
import { inviteCode, login, ownerWithFarm, PASSWORD, query, randomMobile } from "./auth";

// ADR-015: password login with the phone or the email; SMS code login is off in this build (AUTH_SMS_ENABLED unset).

test("sign up with a phone and a password, log out, then sign in again", async ({ page, context }) => {
  const phone = randomMobile();
  const e164 = await login(page, "fr", phone);
  await expect(page).toHaveURL(/\/fr\/onboarding$/); // a new account has no organisation yet

  const sid = (await context.cookies()).find((c) => c.name === "__Secure-sid");
  expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  const sessions = () =>
    query<{ n: number }>(`SELECT count(*)::int AS n FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u."phoneNumber" = $1`, [e164]).then(([r]) => r.n);
  expect(await sessions()).toBe(0);
  await page.goto("/fr/dashboard");
  await expect(page).toHaveURL(/\/fr\/login$/);

  await login(page, "fr", `+212 ${phone.slice(1)}`); // any spelling of the number
  await expect(page).toHaveURL(/\/fr\/onboarding$/);
  expect(await sessions()).toBe(1);
});

test("a wrong password shows the one translated error (Arabic), and no code login is offered", async ({ page }) => {
  await page.goto("/ar/login");
  await expect(page.getByRole("link", { name: "استلام رمز عبر الرسائل القصيرة" })).toHaveCount(0);
  await page.getByLabel("الهاتف أو البريد الإلكتروني").fill(randomMobile());
  await page.getByLabel("كلمة المرور", { exact: true }).fill("not the password");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  // Scoped to <main>: Next's route announcer is also role="alert".
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("الهاتف أو البريد الإلكتروني أو كلمة المرور غير صحيحة.");

  await page.goto("/ar/login/code"); // SMS login is off: back to the password login
  await expect(page).toHaveURL(/\/ar\/login$/);
});

test("auth endpoints refuse cross-site requests (CSRF), and the SMS code endpoints are off", async ({ request }) => {
  expect((await request.post("/api/auth/sign-in", { data: { identifier: "0612345678", password: PASSWORD } })).status()).toBe(403);
  expect((await request.post("/api/auth/sign-up", { data: { phone: "0612345678", password: PASSWORD } })).status()).toBe(403);
  expect((await request.post("/api/auth/request-code", { data: { phone: "0612345678" } })).status()).toBe(404);
});

// The production build checks the captcha for real (the sign-up form solved one); a bare request is refused.
test("a sign-up without a solved captcha is refused", async ({ page }) => {
  await page.goto("/fr/signup");
  const status = await page.evaluate(() =>
    fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "poultry" },
      body: JSON.stringify({ phone: "0612345678", password: "a long enough password" }),
    }).then((r) => r.status),
  );
  expect(status).toBe(400);
});

// After 3 wrong passwords sign-in wants a captcha. The form then solves one and the right password signs in.
test("after 3 wrong passwords, the form solves a captcha and the right password signs in", async ({ page, browser }) => {
  const phone = randomMobile();
  const setup = await browser.newPage();
  await login(setup, "fr", phone); // the account
  await setup.close();

  await page.goto("/fr/login");
  await page.getByLabel("Téléphone ou e-mail").fill(phone);
  const alert = page.getByRole("main").getByRole("alert");
  const send = async (password: string) => {
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    const [res] = await Promise.all([page.waitForResponse("**/api/auth/sign-in"), page.getByRole("button", { name: "Se connecter", exact: true }).click()]);
    return res;
  };

  for (let i = 0; i < 3; i++) expect((await send("not the password")).status()).toBe(401);
  await expect(alert).toHaveText("Téléphone, e-mail ou mot de passe incorrect.");

  expect((await send(PASSWORD)).status()).toBe(400); // no captcha yet: the password isn't even checked
  await expect(alert).toHaveText("La vérification de sécurité a échoué. Réessayez.");

  const res = await send(PASSWORD); // the click waits for the captcha solved in the browser
  expect(res.request().postDataJSON().captcha).toMatchObject({ challenge: expect.any(Object), solution: expect.any(Object) });
  expect(res.status()).toBe(200);
  await expect(page).toHaveURL(/\/fr\/onboarding$/);
});

// ADR-015: no SMS or email, so the owner gives a reset code; using it signs every other device out.
test("the owner's reset code lets a worker set a new password, and signs out their other phone", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage du Mot de Passe");
  const phone = randomMobile();
  await page.goto("/fr/settings/members");
  await page.getByRole("button", { name: "Inviter un membre" }).click(); // the invite form is in a sheet
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  const code = await inviteCode(page);

  const workerContext = await browser.newContext({ ...test.info().project.use });
  const worker = await workerContext.newPage();
  await login(worker, "fr", phone, code);
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);

  await page.reload();
  page.once("dialog", (d) => void d.accept());
  // The members screen writes the number as people do ("06 12 34 56 78"), in its labels too
  const written = phone.replace(/(\d{2})(?=\d)/g, "$1 ");
  await page.getByLabel(`Autres actions : ${written}`).click(); // the rarer actions sit in the row's « ⋯ »
  await page.getByRole("button", { name: `Réinitialiser le mot de passe de ${written}` }).click();
  const shown = page.locator("output").filter({ hasText: /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/ });
  await expect(shown).toBeVisible();
  const resetCode = (await shown.textContent())!;

  const phone2 = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await phone2.goto("/fr/reset");
  await phone2.getByLabel("Téléphone ou e-mail").fill(phone);
  await phone2.getByLabel("Code", { exact: true }).fill(resetCode);
  await phone2.getByLabel("Mot de passe", { exact: true }).fill("a brand new phrase");
  await phone2.getByLabel("Confirmer le mot de passe").fill("a brand new phrase");
  await phone2.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(phone2).toHaveURL(/\/fr\/dashboard$/);

  await worker.goto("/fr/dashboard");
  await expect(worker).toHaveURL(/\/fr\/login$/); // the old session ended
  await workerContext.close();
});

// T25 S3: the Content-Security-Policy is sent, and the app itself never trips it.
test("pages send a Content-Security-Policy that the app doesn't violate", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/fr/signup");
  expect(res?.headers()["content-security-policy"]).toMatch(/object-src 'none'.*frame-ancestors 'none'/);
  await expect(page.getByRole("button", { name: "Créer le compte" })).toBeEnabled(); // the captcha was fetched and solved
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
  await page.getByRole("banner").getByRole("button", { name: "Nadia Testeur Propriétaire" }).click(); // U20: the header's account menu
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

test("« Informations personnelles »: a signed-in user changes their password, signs out, and signs in with the new one", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const NEW = "e2e brand new phrase";
  const e164 = await ownerWithFarm(page, "Élevage du Nouveau Mot de Passe");
  const phone = `0${e164.slice(4)}`;
  const other = await browser.newPage(); // another phone of the same user
  await login(other, "fr", phone);
  await other.waitForURL(/\/fr\/dashboard$/);

  await page.goto("/fr/organizations");
  const section = page.getByRole("region", { name: "Informations personnelles" });
  const fill = async (current: string) => {
    await section.getByLabel("Mot de passe actuel", { exact: true }).fill(current);
    await section.getByLabel("Nouveau mot de passe", { exact: true }).fill(NEW);
    await section.getByLabel("Confirmer le nouveau mot de passe", { exact: true }).fill(NEW);
  };
  const submit = section.getByRole("button", { name: "Changer le mot de passe" });

  await page.context().setOffline(true); // online only: said, and nothing sent
  await expect(section.getByText("Hors ligne : à faire une fois connecté.")).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.context().setOffline(false);

  await fill("not the password");
  await submit.click();
  await expect(section.getByRole("alert")).toHaveText("Mot de passe actuel incorrect.");
  await fill(PASSWORD);
  await submit.click();
  await expect(section.getByRole("status")).toHaveText("Mot de passe changé. Vos autres appareils sont déconnectés.");

  await other.goto("/fr/dashboard");
  await expect(other).toHaveURL(/\/fr\/login$/); // the other phone's session ended
  await other.close();
  await page.goto("/fr/dashboard");
  await expect(page).toHaveURL(/\/fr\/dashboard$/); // this one stayed

  await page.getByRole("banner").getByRole("button", { name: "Nadia Testeur Propriétaire" }).click();
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  await page.getByLabel("Téléphone ou e-mail").fill(phone);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Téléphone, e-mail ou mot de passe incorrect."); // the old one
  await page.getByLabel("Mot de passe", { exact: true }).fill(NEW);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
});
