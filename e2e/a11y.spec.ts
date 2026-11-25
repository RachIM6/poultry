import { expect, test, type Page } from "@playwright/test";
import { query } from "./auth";
import { openScreen, orgOf, overflow, realisticOwner } from "./screens";

// SPEC X4 on every main screen, in French and in Arabic, with the realistic data of e2e/screens.ts:
// 1. every visible button, link, field, disclosure and role="button" / "tab" / "menuitem" is at least 44 × 44 CSS px,
//    on the 412 px phone and at 320 px (a link inside running text is exempt, WCAG 2.5.8's inline exception; a checkbox
//    or radio is clicked through its label, so the label is measured);
// 2. every form control and role="button" / "tab" / "menuitem" has an accessible name, as the accessibility tree
//    computes it (not guessed from the markup); a file input has a label of its own (Chromium names an unlabelled one
//    "Choose File", which the tree check would take for a name);
// 3. zoom: at 320 CSS px wide (WCAG 1.4.10 reflow, i.e. 1280 px at 400 %) the page doesn't scroll sideways;
// 4. contrast, WCAG 2.2 AA: text 4.5:1, large text (≥ 24 px, or ≥ 18.66 px bold) 3:1, a field's edge and the focus
//    ring 3:1 (1.4.3, 1.4.11), computed in the page against the first opaque background behind;
// and all of it again once every closed <details> and every collapsed disclosure button (aria-expanded="false", a
// destructive one aside) is open, so a control that a tap reveals is checked too.

const ZOOM_WIDTH = 320;
const CONTROLS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem]';
// Opening these only shows a confirmation, but they are left alone all the same.
const DESTRUCTIVE = /Annuler la vente|Supprimer|Rouvrir|إلغاء البيع|حذف|إعادة فتح/;
type Failures = Record<"targets" | "names" | "files" | "contrast" | "zoom", string[]>;

/** Visible controls smaller than 44 × 44 CSS px, as `tag "text" W×H`. */
function smallTargets(page: Page) {
  return page.evaluate((selector) => {
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
    for (const el of document.querySelectorAll(selector)) {
      let box = el.getBoundingClientRect();
      const labels = el instanceof HTMLInputElement && el.labels ? [...el.labels] : [];
      // A checkbox, a radio or a visually hidden input is clicked through its label: the label is the target.
      if (labels.length && (["checkbox", "radio"].includes((el as HTMLInputElement).type) || box.width <= 1 || box.height <= 1)) {
        box = labels.map((l) => l.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      }
      if (box.width <= 1 || box.height <= 1 || getComputedStyle(el).visibility === "hidden") continue; // not shown
      if ((box.width >= MIN && box.height >= MIN) || inRunningText(el)) continue;
      const type = el instanceof HTMLInputElement ? `[${el.type}]` : el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
      found.push(`${el.tagName.toLowerCase()}${type} "${text(labels[0] ?? el)}" ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return found;
  }, CONTROLS);
}

/** Visible form controls without an accessible name in the accessibility tree, skipping those already checked. */
async function unnamedControls(page: Page) {
  const found: string[] = [];
  const unchecked = 'input:not([type=hidden]), select, textarea, button, [role=button], [role=tab], [role=menuitem]';
  const controls = page.locator(unchecked.split(", ").map((s) => `${s}:not([data-a11y-named])`).join(", "));
  // Numbered first: a locator by position would shift as the marks change what the selector matches.
  const ids = await controls.filter({ visible: true }).evaluateAll((els) => {
    const from = document.querySelectorAll("[data-a11y-named]").length;
    return els.map((el, i) => (el.setAttribute("data-a11y-named", String(from + i)), String(from + i)));
  });
  for (const id of ids) {
    const control = page.locator(`[data-a11y-named="${id}"]`);
    // The first line is `- role "name"…` when named, `- role`, `- role: value` or `- role [checked]` when not.
    const first = (await control.ariaSnapshot({ timeout: 5_000 }).catch(() => "")).split("\n")[0];
    if (!first || /^- ['"]?[a-z]+ ["/]/.test(first)) continue; // named, or gone (re-rendered) or hidden from the tree
    found.push(`${first} ${await control.evaluate((el) => el.outerHTML.slice(0, 120), null, { timeout: 5_000 }).catch(() => "")}`);
  }
  return found;
}

/** File inputs without a label of their own: a <label for>, a wrapping <label>, aria-label or aria-labelledby. */
function unlabelledFiles(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>("input[type=file]")]
      .filter((input) => {
        const said = (el: Element | null | undefined) => Boolean(el?.textContent?.trim());
        const labelledBy = (input.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
        return ![...(input.labels ?? [])].some(said) && !input.getAttribute("aria-label")?.trim() && !labelledBy.some((id) => said(document.getElementById(id)));
      })
      .map((input) => input.outerHTML.slice(0, 120)),
  );
}

/**
 * Contrast below WCAG 2.2 AA, as `fg on bg ratio < need` with an example. Text: each visible text node against the
 * first opaque background up its ancestors (an ancestor with a background image is skipped: unknown). Fields: the
 * edge 3:1 against the background around it, unless the field's own fill does it (a bare field in a box: the box's).
 * Focus: each control, focused after a key press (so :focus-visible matches), has an outline 3:1 against what is
 * behind the ring, or a ring or edge that changes. Disabled controls and a watermark are exempt (1.4.3). SVG text is
 * read from its fill; shapes behind it are not seen.
 */
async function lowContrast(page: Page) {
  await page.keyboard.press("Tab"); // keyboard modality: a script's focus() then shows :focus-visible
  return page.evaluate((selector) => {
    type RGBA = [number, number, number, number];
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const parsed = new Map<string, RGBA>();
    const rgba = (css: string): RGBA => {
      if (!parsed.has(css)) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = css; // the canvas reads any CSS colour (oklch, color-mix…)
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        parsed.set(css, [r, g, b, a / 255]);
      }
      return parsed.get(css)!;
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as RGBA;
    const backgrounds = new Map<Element, RGBA | null>();
    // The opaque colour behind an element: its own background and its ancestors', composited, over white.
    const behind = (el: Element | null): RGBA | null => {
      if (!el) return [255, 255, 255, 1];
      if (!backgrounds.has(el)) {
        const style = getComputedStyle(el);
        const own = rgba(style.backgroundColor);
        const below = own[3] >= 1 ? null : behind(el.parentElement);
        backgrounds.set(el, style.backgroundImage !== "none" ? null : own[3] >= 1 ? own : below && over(own, below));
      }
      return backgrounds.get(el)!;
    };
    const opacity = (el: Element) => {
      let o = 1;
      for (let p: Element | null = el; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
      return o;
    };
    const lum = ([r, g, b]: RGBA) => {
      const c = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const ratio = (a: RGBA, b: RGBA) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const hex = (c: RGBA) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
    const found: { key: string; example: string }[] = [];
    const flag = (fg: RGBA, bg: RGBA, need: number, what: string, example: string) => {
      const r = ratio(fg, bg);
      if (r < need - 0.005) found.push({ key: `${what} ${hex(fg)} on ${hex(bg)} ${r.toFixed(2)}:1 < ${need}:1`, example: example.trim().replace(/\s+/g, " ").slice(0, 40) });
    };
    const disabled = (el: Element) => Boolean(el.closest(':disabled, [aria-disabled="true"]'));
    const shown = (el: Element) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !el.closest(".sr-only");
    // A watermark ("PROJET" across a draft statement): hidden from assistive tech and from taps, said again in the page.
    const watermark = (el: Element) => {
      const hidden = el.closest('[aria-hidden="true"]');
      return Boolean(hidden && getComputedStyle(hidden).pointerEvents === "none");
    };

    // 1.4.3: text.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent!.trim() || el.closest("option, script, style, noscript") || !shown(el) || disabled(el) || watermark(el)) continue;
      const style = getComputedStyle(el);
      const svg = el instanceof SVGElement;
      const fgCss = svg ? style.fill : style.color;
      if (svg && !/^(rgb|#|oklch|color)/.test(fgCss)) continue; // a url() or none fill
      const bg = behind(el);
      if (!bg) continue;
      const fg = rgba(fgCss);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      flag(over([fg[0], fg[1], fg[2], fg[3] * opacity(el)], bg), bg, large ? 3 : 4.5, "text", n.textContent!);
    }

    // 1.4.3 and 1.4.11: what is typed or shown in a field, and the field's edge.
    for (const el of document.querySelectorAll<HTMLInputElement>('input:not([type=hidden], [type=checkbox], [type=radio], [type=file], [type=submit], [type=button], [type=range], [type=color]), select, textarea')) {
      if (!shown(el) || disabled(el)) continue;
      const style = getComputedStyle(el);
      const fill = behind(el);
      if (!fill) continue;
      const empty = !(el instanceof HTMLSelectElement) && !el.value;
      if (!empty) flag(rgba(style.color), fill, 4.5, "field text", el.value || el.name);
      else if (el.placeholder) flag(rgba(getComputedStyle(el, "::placeholder").color), fill, 4.5, "placeholder", el.placeholder);
      // A bare field inside a box (a stepper's − field +): the box is what marks it.
      const bare = (e: Element) => parseFloat(getComputedStyle(e).borderBottomWidth) < 1 && rgba(getComputedStyle(e).backgroundColor)[3] === 0;
      const box = bare(el) && el.parentElement ? el.parentElement : el;
      const [boxFill, boxAround] = [behind(box), behind(box.parentElement)];
      if (!boxFill || !boxAround || ratio(boxFill, boxAround) >= 3) continue; // the fill marks the field
      const edge = rgba(getComputedStyle(box).borderBottomColor);
      if (bare(box) || parseFloat(getComputedStyle(box).borderBottomWidth) < 1 || edge[3] === 0) found.push({ key: "field without an edge or a fill", example: el.name || el.id });
      else flag(over(edge, boxAround), boxAround, 3, "field edge", el.name || el.id || el.outerHTML.slice(0, 40));
    }

    // 2.4.7 and 1.4.11: the focus indicator.
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!shown(el) || disabled(el) || el.getClientRects().length === 0) continue;
      const before = getComputedStyle(el);
      const [border, shadow] = [before.borderColor, before.boxShadow];
      el.focus({ preventScroll: true });
      if (document.activeElement !== el || !el.matches(":focus-visible")) continue; // not focusable, or no ring to see
      const style = getComputedStyle(el);
      const what = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`;
      // The ring lies outside the box (outline-offset): behind it is the first ancestor that holds the whole ring.
      const r = el.getBoundingClientRect();
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
      let holder = el.parentElement;
      for (; holder && holder !== document.body; holder = holder.parentElement) {
        const h = holder.getBoundingClientRect();
        if (h.left <= r.left - reach && h.top <= r.top - reach && h.right >= r.right + reach && h.bottom >= r.bottom + reach) break;
      }
      const around = behind(holder);
      if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
        if (around) flag(over(rgba(style.outlineColor), around), around, 3, "focus ring", what);
      } else if (style.borderColor === border && style.boxShadow === shadow) found.push({ key: "no focus indicator", example: what });
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return found;
  }, CONTROLS);
}

/** Opens every closed <details> and clicks every collapsed disclosure button but a destructive one. */
async function openHidden(page: Page) {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details:not([open])")) [d.open, d.dataset.a11yOpened] = [true, ""];
  });
  // One at a time: a click can re-render the list (a button that reveals a form is replaced by it).
  for (let i = 0; i < 40; i++) {
    const button = page.locator('[aria-expanded="false"]:not([data-a11y-tried])').filter({ visible: true }).first();
    if (!(await button.count())) break;
    const name = await button.evaluate((el) => (el.setAttribute("data-a11y-tried", ""), el.getAttribute("aria-label") ?? el.textContent ?? ""));
    if (!DESTRUCTIVE.test(name)) await button.click({ timeout: 5_000 }).catch(() => {});
  }
}

/** Closes what openHidden opened (a button that the form replaced is gone: its form's own Cancel would close it). */
async function closeHidden(page: Page) {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details[data-a11y-opened]")) d.open = false;
  });
  const expanded = page.locator('[data-a11y-tried][aria-expanded="true"]');
  for (let i = 0; i < 40 && (await expanded.count()); i++) await expanded.first().click({ timeout: 5_000 }).catch(() => {});
}

/** "a ×3" for repeated findings (a control in every row of a table). */
const tally = (found: string[]) => [...Map.groupBy(found, (f) => f)].map(([f, all]) => (all.length > 1 ? `${f} ×${all.length}` : f));

/** A finding seen before and after opening counts once: the larger of its two counts. */
function merge(a: string[], b: string[]) {
  const count = (xs: string[]) => Map.groupBy(xs, (x) => x);
  const [ca, cb] = [count(a), count(b)];
  return [...new Set([...a, ...b])].flatMap((x) => Array<string>(Math.max(ca.get(x)?.length ?? 0, cb.get(x)?.length ?? 0)).fill(x));
}

async function checkState(tab: Page, zoom: Page) {
  const contrast = await lowContrast(tab);
  return {
    targets: [...(await smallTargets(tab)), ...(await smallTargets(zoom)).map((f) => `${f} at ${ZOOM_WIDTH} px`)],
    names: await unnamedControls(tab),
    files: await unlabelledFiles(tab),
    contrast: contrast.map((c) => c.key),
    examples: new Map(contrast.map((c) => [c.key, c.example])),
    zoom: [await overflow(zoom, ZOOM_WIDTH)].filter((w): w is string => Boolean(w)),
  };
}

async function check(tab: Page, url: string, failures: Failures, zoom: Page) {
  await Promise.all([openScreen(tab, url), openScreen(zoom, url)]);
  const closed = await checkState(tab, zoom);
  await Promise.all([openHidden(tab), openHidden(zoom)]);
  const opened = await checkState(tab, zoom);
  await Promise.all([closeHidden(tab), closeHidden(zoom)]);
  for (const kind of ["targets", "names", "files", "zoom"] as const) for (const f of tally(merge(closed[kind], opened[kind]))) failures[kind].push(`${url}: ${f}`);
  for (const f of tally(merge(closed.contrast, opened.contrast))) {
    const key = f.replace(/ ×\d+$/, "");
    failures.contrast.push(`${url}: ${f} "${closed.examples.get(key) ?? opened.examples.get(key)}"`);
  }
}

function report(failures: Failures) {
  expect.soft(failures.targets, `smaller than 44 × 44 px:\n${failures.targets.join("\n")}`).toEqual([]);
  expect.soft(failures.names, `form controls without an accessible name:\n${failures.names.join("\n")}`).toEqual([]);
  expect.soft(failures.files, `file inputs without a label:\n${failures.files.join("\n")}`).toEqual([]);
  expect.soft(failures.contrast, `below WCAG AA contrast:\n${failures.contrast.join("\n")}`).toEqual([]);
  expect.soft(failures.zoom, `wider than ${ZOOM_WIDTH} px:\n${failures.zoom.join("\n")}`).toEqual([]);
}

const empty = (): Failures => ({ targets: [], names: [], files: [], contrast: [], zoom: [] });

test("the login screen: 44 px targets, named fields, contrast, reflow at 320 px, in French and in Arabic", async ({ page, context }) => {
  const zoom = await context.newPage();
  await zoom.setViewportSize({ width: ZOOM_WIDTH, height: 640 });
  const failures = empty();
  for (const locale of ["fr", "ar"]) await check(page, `/${locale}/login`, failures, zoom);
  report(failures);
});

test("every main screen: 44 px targets, named fields, contrast, reflow at 320 px, closed and opened, in French and in Arabic", async ({ page, context }) => {
  test.setTimeout(600_000); // 4 min on a laptop: every screen twice (closed and opened), in two locales
  const { e164, screens } = await realisticOwner(page);
  const failures = empty();
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
