import { expect, test } from "@playwright/test";
import { ownerWithFarm, query, scopeRemembered } from "./auth";

// T12 acceptance, browser part: a test notification reaches the inbox. The push itself needs a real phone
// (headless Chromium has no push service): checked by hand on Android and an installed iPhone.
test("a test notification reaches the inbox and can be marked read", async ({ page }) => {
  test.setTimeout(60_000);
  const e164 = await ownerWithFarm(page, "Ferme des Notifications");
  await scopeRemembered(page);
  await page.goto("/fr/inbox");
  await expect(page.getByText("Aucune notification.")).toBeVisible();

  await page.getByRole("button", { name: "M’envoyer une notification de test" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Envoyée" })).toBeVisible();
  const item = page.getByRole("button", { name: /Notification de test/ });
  await expect(item).toBeVisible(); // pulled into the phone's inbox
  await expect(item).toContainText("Non lue");

  await item.click();
  await expect(item).not.toContainText("Non lue");
  const readAt = async () =>
    (
      await query<{ readAt: Date | null }>(
        `SELECT n."readAt" FROM "Notification" n JOIN "User" u ON u.id = n."userId" WHERE u."phoneNumber" = $1`,
        [e164],
      )
    )[0]?.readAt ?? null;
  await expect.poll(readAt).not.toBeNull(); // the read receipt synced
});
