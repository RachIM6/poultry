import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, scopeRemembered } from "./auth";

// Performance audit H1: the home sends the day's tasks without waiting for the books. The "Argent" card is its own
// Suspense boundary: the page's stream carries the card's placeholder (aria-busy) first, its figures in a later row.
test("the home streams the day's tasks before the money card's figures", async ({ page }) => {
  test.setTimeout(90_000);
  await ownerWithFarm(page, "Élevage en Flux");
  await scopeRemembered(page);
  await farmWithBatch(page);

  const html = await (await page.request.get("/fr/dashboard")).text();
  const placeholder = html.search(/aria-busy\\?"\s*:\s*true/);
  const figures = html.search(/href\\?"\s*:\s*\\?"\/fr\/treasury/); // the cash row's link (its label ships with the page's messages)
  expect(placeholder).toBeGreaterThan(-1);
  expect(figures).toBeGreaterThan(placeholder);

  await page.goto("/fr/dashboard");
  await expect(page.getByRole("link", { name: /Saisie du jour · Bâtiment 1/ })).toBeVisible({ timeout: 30_000 });
  // UX review A6: the strip's legend names only the states it shows: placed today (day 0), only days to come.
  await expect(page.getByRole("list", { name: "Légende" }).getByRole("listitem")).toHaveText(["À venir"]);
  await expect(page.getByRole("region", { name: "Argent" })).toContainText("Trésorerie disponible");
  await expect(page.getByRole("region", { name: "Argent" })).not.toHaveAttribute("aria-busy", "true");
});
