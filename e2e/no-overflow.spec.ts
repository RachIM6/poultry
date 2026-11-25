import { expect, test, type Page } from "@playwright/test";
import { query } from "./auth";
import { openScreen, orgOf, overflow, realisticOwner, unitsMoved } from "./screens";

// SPEC X4: no screen is wider than the phone. A wide table scrolls in its own container, never the page: a page wider
// than the screen shifts every tap below it (a /budget table once made the page 421 px on a 412 px phone). An owner
// with realistic data (e2e/screens.ts) opens every main screen in French and in Arabic, one locale per tab in parallel.
// The width is the device's (412 px), not window.innerWidth: a mobile browser zooms out to fit a page that overflows,
// and innerWidth then grows with it.
// The Arabic screens also keep "DH" and "kg" after their number (ADR-004), which a right-to-left line needs an isolate for.

test("every main screen fits a phone's width, in French and in Arabic, and keeps units after their number in Arabic", async ({ page, context }) => {
  test.setTimeout(240_000);
  const { e164, screens } = await realisticOwner(page);
  const width = page.viewportSize()!.width;
  const failures: string[] = [];
  const moved: string[] = [];
  const visit = async (tab: Page, locale: "fr" | "ar", paths: string[]) => {
    for (const path of paths) {
      const url = `/${locale}${path}`;
      await openScreen(tab, url);
      const found = await overflow(tab, width);
      if (found) failures.push(`${url}: ${found}`);
      if (locale === "ar") for (const text of await unitsMoved(tab)) moved.push(`${url}: ${text}`);
    }
  };
  const ar = await context.newPage();
  await Promise.all([visit(page, "fr", screens), visit(ar, "ar", screens)]);

  // The receipts-and-expenses book is the view of an individual farmer's books.
  await query(`UPDATE "LegalEntity" SET books = 'cash_book' WHERE "organizationId" = ${orgOf}`, [e164]);
  await Promise.all([visit(page, "fr", ["/books?view=cash"]), visit(ar, "ar", ["/books?view=cash"])]);

  expect(failures, `wider than the ${width} px screen:\n${failures.join("\n")}`).toEqual([]);
  expect(moved, "a unit before its number in Arabic").toEqual([]);
});
