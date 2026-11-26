import { expect, test } from "@playwright/test";
import { login, ownerWithFarm, randomMobile, inviteCode } from "./auth";

// Two browsers: the owner's phone and the worker's phone (T7 manual check, automated).
test("the owner invites a worker, who joins without owner screens, then removes them", async ({ page, browser }) => {
  test.setTimeout(60_000); // two code logins and an onboarding: close to the 30 s default when 4 workers share the CPU
  await ownerWithFarm(page, "Ferme des Oliviers");
  await page.getByRole("link", { name: "Plus", exact: true }).click(); // tasks/plan-ui.md U2: the "Plus" tab
  await page.getByRole("link", { name: "Membres" }).click();
  await expect(page.getByRole("heading", { name: "Membres" })).toBeVisible();

  const workerPhone = randomMobile();
  await page.getByLabel("Numéro de téléphone").fill(workerPhone);
  await page.getByLabel("Rôle", { exact: true }).selectOption("worker");
  await page.getByRole("button", { name: "Inviter" }).click();
  await expect(page.getByText("Invitation enregistrée.")).toBeVisible();
  const code = await inviteCode(page);
  await expect(page.getByText(workerPhone.replace(/(\d{2})(?=\d)/g, "$1 "))).toBeVisible(); // pending, written "06 12 34 56 78"
  await expect(page.getByText(/^Expire le \d{1,2} \p{L}+ \d{4}$/u)).toBeVisible(); // and until when its code works

  const workerContext = await browser.newContext({ ...test.info().project.use });
  const worker = await workerContext.newPage();
  await login(worker, "fr", workerPhone, code);
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);
  await expect(worker.getByRole("heading", { name: "Ferme des Oliviers" })).toBeVisible();
  await worker.goto("/fr/more");
  await expect(worker.getByRole("link", { name: "Membres" })).toHaveCount(0);
  await worker.goto("/fr/settings/members");
  await expect(worker).toHaveURL(/\/fr\/dashboard$/);

  await page.reload(); // the invitation is now a membership
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(0);

  await worker.goto("/fr/dashboard");
  await expect(worker).toHaveURL(/\/fr\/login$/); // all their devices are signed out
  await workerContext.close();
});
