import { expect, test, type Page } from "@playwright/test";
import { query } from "./auth";
import { openScreen, orgOf, overflow, realisticOwner } from "./screens";

// SPEC X4 on every main screen, in French and in Arabic, with the realistic data of e2e/screens.ts:
// 1. every visible button, link, field and disclosure is at least 44 × 44 CSS px (a link inside running text is exempt,
//    WCAG 2.5.8's inline exception; a checkbox or radio is clicked through its label, so the label is measured);
// 2. every form control has an accessible name, as the accessibility tree computes it (not guessed from the markup);
// 3. zoom: at 320 CSS px wide (WCAG 1.4.10 reflow, i.e. 1280 px at 400 %) the page doesn't scroll sideways.

const ZOOM_WIDTH = 320;
type Failures = Record<"targets" | "names" | "zoom", string[]>;

/** Visible controls smaller than 44 × 44 CSS px, as `tag "text" W×H`. */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const MIN = 43.5; // sub-pixel layout: 43.6 px is a 44 px box
    const text = (el: Element) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    // A link in a sentence: laid out inline, with words of the sentence around it in its block.
    const inRunningText = (el: Element) => {
      if (el.tagName !== "A" || getComputedStyle(el).display !== "inline") return false;
      let block = el.parentElement!;
      while (getComputedStyle(block).display === "inline") block = block.parentElement!;
      const words = (n: Node) => (n.textContent ?? "").replace(/\s/g, "").length;
      return words(block) > words(el);
    };
    const found: string[] = [];
    for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")) {
      let box = el.getBoundingClientRect();
      const labels = el instanceof HTMLInputElement && el.labels ? [...el.labels] : [];
      // A checkbox, a radio or a visually hidden input is clicked through its label: the label is the target.
      if (labels.length && (["checkbox", "radio"].includes((el as HTMLInputElement).type) || box.width <= 1 || box.height <= 1)) {
        box = labels.map((l) => l.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      }
      if (box.width <= 1 || box.height <= 1 || getComputedStyle(el).visibility === "hidden") continue; // not shown
      if ((box.width >= MIN && box.height >= MIN) || inRunningText(el)) continue;
      const type = el instanceof HTMLInputElement ? `[${el.type}]` : "";
      found.push(`${el.tagName.toLowerCase()}${type} "${text(labels[0] ?? el)}" ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return found;
  });
}

/** Visible form controls without an accessible name in the accessibility tree. */
async function unnamedControls(page: Page) {
  const found: string[] = [];
  for (const control of await page.locator("input:not([type=hidden]), select, textarea, button").filter({ visible: true }).all()) {
    // The first line is `- role "name"…` when named, `- role`, `- role: value` or `- role [checked]` when not.
    const first = (await control.ariaSnapshot({ timeout: 5_000 }).catch(() => "")).split("\n")[0];
    if (!first || /^- ['"]?[a-z]+ ["/]/.test(first)) continue; // named, or gone (re-rendered) or hidden from the tree
    found.push(`${first} ${await control.evaluate((el) => el.outerHTML.slice(0, 120)).catch(() => "")}`);
  }
  return found;
}

/** "a ×3" for repeated findings (a control in every row of a table). */
const tally = (found: string[]) => [...Map.groupBy(found, (f) => f)].map(([f, all]) => (all.length > 1 ? `${f} ×${all.length}` : f));

async function check(tab: Page, url: string, failures: Failures, zoom: Page) {
  await openScreen(tab, url);
  for (const f of tally(await smallTargets(tab))) failures.targets.push(`${url}: ${f}`);
  for (const f of tally(await unnamedControls(tab))) failures.names.push(`${url}: ${f}`);
  await openScreen(zoom, url);
  const wide = await overflow(zoom, ZOOM_WIDTH);
  if (wide) failures.zoom.push(`${url}: ${wide}`);
}

function report(failures: Failures) {
  expect.soft(failures.targets, `smaller than 44 × 44 px:\n${failures.targets.join("\n")}`).toEqual([]);
  expect.soft(failures.names, `form controls without an accessible name:\n${failures.names.join("\n")}`).toEqual([]);
  expect.soft(failures.zoom, `wider than ${ZOOM_WIDTH} px:\n${failures.zoom.join("\n")}`).toEqual([]);
}

test("the login screen: 44 px targets, named fields, reflow at 320 px, in French and in Arabic", async ({ page, context }) => {
  const zoom = await context.newPage();
  await zoom.setViewportSize({ width: ZOOM_WIDTH, height: 640 });
  const failures: Failures = { targets: [], names: [], zoom: [] };
  for (const locale of ["fr", "ar"]) await check(page, `/${locale}/login`, failures, zoom);
  report(failures);
});

test("every main screen: 44 px targets, named fields, reflow at 320 px, in French and in Arabic", async ({ page, context }) => {
  test.setTimeout(480_000);
  const { e164, screens } = await realisticOwner(page);
  const failures: Failures = { targets: [], names: [], zoom: [] };
  // One tab per locale at the phone's width, and one at 320 px.
  const tabs = async () => {
    const [phone, zoom] = [await context.newPage(), await context.newPage()];
    await zoom.setViewportSize({ width: ZOOM_WIDTH, height: 640 });
    return { phone, zoom };
  };
  const [fr, ar] = [await tabs(), await tabs()];
  const visit = async ({ phone, zoom }: { phone: Page; zoom: Page }, locale: "fr" | "ar", paths: string[]) => {
    for (const path of paths) await check(phone, `/${locale}${path}`, failures, zoom);
  };
  await Promise.all([visit(fr, "fr", screens), visit(ar, "ar", screens)]);

  // The receipts-and-expenses book is the view of an individual farmer's books.
  await query(`UPDATE "LegalEntity" SET books = 'cash_book' WHERE "organizationId" = ${orgOf}`, [e164]);
  await Promise.all([visit(fr, "fr", ["/books?view=cash"]), visit(ar, "ar", ["/books?view=cash"])]);

  report(failures);
});
