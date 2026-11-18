import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { farmWithBatch, ownerWithFarm, scopeRemembered } from "./auth";

// SPEC-m5 screens in Arabic (SPEC I3): right to left, with their Arabic titles and content from the phone's data.
const ar = JSON.parse(readFileSync("messages/ar.json", "utf8")) as Record<string, Record<string, string>>;

test("the M5 screens render right to left in Arabic", async ({ page }) => {
  test.setTimeout(120_000);
  await ownerWithFarm(page, "Élevage Arabe");
  await scopeRemembered(page);
  await farmWithBatch(page);

  for (const [path, title, content] of [
    ["/ar/prices", ar.Prices.title, ar.Prices.none],
    ["/ar/planning", ar.Planning.title, ar.Planning.noDowntime],
    ["/ar/organizations", ar.Organizations.title, ar.Organizations.current],
  ] as const) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText(content, { exact: true })).toBeVisible();
  }
});
