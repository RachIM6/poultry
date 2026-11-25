import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import ar from "../../messages/ar.json";

// ADR-004: Arabic mirrors the layout, so classes say start / end (ms-, pe-, start-, text-end…), never left / right.
const PHYSICAL =
  /(?<![\w-])-?(?:m[lr]|p[lr]|left|right|inset-[lr]|scroll-[mp][lr])-(?:\d|px\b|auto\b|full\b|\[)|(?<![\w-])(?:text|float|clear)-(?:left|right)(?![\w-])|(?<![\w-])(?:border|rounded)-(?:[lr]|[tb][lr])(?!\w)/;

it("spots physical classes only", () => {
  for (const c of ["ml-2", "md:pr-4", "-mr-px", "left-0", "right-[3px]", "text-left", "border-l", "border-r-2", "rounded-tl-lg", "rounded-r"]) expect(c).toMatch(PHYSICAL);
  for (const c of ["ms-2", "pe-4", "start-0", "text-end", "border-line", "rounded-lg", "the 7 months left", "const right = 1", "copyright-2026"]) expect(c).not.toMatch(PHYSICAL);
});

it("uses logical classes in src", () => {
  const files = readdirSync(new URL("..", import.meta.url), { recursive: true, encoding: "utf8" }).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"));
  const found = files.flatMap((f) =>
    readFileSync(new URL(`../${f.replaceAll("\\", "/")}`, import.meta.url), "utf8")
      .split("\n")
      .flatMap((line, i) => (PHYSICAL.test(line) ? [`${f}:${i + 1}: ${line.match(PHYSICAL)![0]}`] : [])),
  );
  expect(found).toEqual([]);
});

// "1 234,50 DH" in an Arabic line comes out "DH 1 234,50": the bidi algorithm moves a Latin unit to the far side of its
// number. Inside FSI … PDI (U+2068 … U+2069, what <bdi> does) the amount keeps its order. Notifications (SMS, push)
// are not screens and are left as they are.
const MONEY_OR_WEIGHT = /\{(amount|limit|cost|margin|weight|kg|paid|breakEven|price|feed|principal|opening|closing|consumption|other|direct|allocated|quantity|standard|average|employer|perEgg|hens|depreciation|indirect)\}/g;
const flat = (obj: object, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v as string]]));

it("isolates amounts and weights in ar.json", () => {
  const loose = flat(ar)
    .filter(([key]) => !key.startsWith("Notifications."))
    .flatMap(([key, text]) => [...text.matchAll(MONEY_OR_WEIGHT)].filter((m) => !/⁨[+−]?$/.test(text.slice(0, m.index))).map((m) => `${key}: ${m[0]}`));
  expect(loose).toEqual([]);
});
