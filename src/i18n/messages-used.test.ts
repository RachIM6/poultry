import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import fr from "../../messages/fr.json";

// SPEC §9.5, FX5: every message key and error code the code uses exists in fr.json (messages.test.ts keeps ar.json in
// step). A text scan, not a type check: good enough for the patterns this code base writes.
// ponytail: regex scan, misses keys built in ways not listed below; move to next-intl's AppConfig typing if that bites.

/** Codes that never reach the screen. */
const SILENT_CODES: Record<string, string> = {
  NO_MEMBERSHIP: "getTenantContext's signal to redirect to /onboarding; never shown",
};

const src = fileURLToPath(new URL("..", import.meta.url));
const files = (readdirSync(src, { recursive: true }) as string[])
  .map((f) => relative(src, join(src, f)).replaceAll("\\", "/"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("test/"))
  // Line comments out: they quote keys as examples ("errors.X").
  .map((f) => ({ file: f, text: readFileSync(join(src, f), "utf8").replace(/(?<=^|\s)\/\/.*$/gm, "") }));

const at = (key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), fr);
const join2 = (ns: string, key: string) => (ns ? `${ns}.${key}` : key);

/** The first argument of the call whose "(" is at `open`, as source text. */
function firstArg(text: string, open: number): string {
  let depth = 0;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      while (++i < text.length && text[i] !== c) if (text[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && depth-- === 0) return text.slice(open + 1, i);
    else if (c === "," && depth === 0) return text.slice(open + 1, i);
  }
  return "";
}

/** Each translator variable of a file, with the namespace it was made for and where. */
function translators(text: string) {
  const found: { name: string; ns: string; at: number }[] = [];
  for (const m of text.matchAll(/\b(?:useTranslations|getTranslations|translatorFor)\(([^)]*)\)/g)) {
    const ns = /"([^"]+)"/.exec(m[1])?.[1] ?? "";
    const before = text.slice(0, m.index);
    const single = /(\w+)\s*=\s*(?:await\s+)?$/.exec(before);
    const all = /\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([^;]*)$/.exec(before);
    if (single) found.push({ name: single[1], ns, at: m.index });
    else if (all) {
      let depth = 0;
      let index = 0;
      for (const c of all[2]) {
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 0) index++;
      }
      found.push({ name: all[1].split(",")[index].trim(), ns, at: m.index });
    }
  }
  return found;
}

it("every literal key passed to a translator exists in fr.json", () => {
  const missing: string[] = [];
  for (const { file, text } of files) {
    const decls = translators(text);
    // A translator received as a parameter (`t: T`) has no namespace.
    const names = new Set(["t", ...decls.map((d) => d.name)]);
    for (const name of names) {
      for (const call of text.matchAll(new RegExp(`(?<![\\w.$])${name}(?:\\.(?:rich|markup|raw|has))?\\(`, "g"))) {
        const ns = decls.findLast((d) => d.name === name && d.at < call.index)?.ns ?? "";
        const arg = firstArg(text, call.index + call[0].length - 1);
        // Literals the argument can evaluate to: the whole argument, or a branch of ?:, ?? or ||. Plain variables are
        // skipped: their values are the literal keys and error codes the other checks cover.
        for (const lit of arg.matchAll(/(?:^|[?:|(])\s*(?:"([^"]*)"|`([^`]*)`)/g)) {
          const [, plain, tpl] = lit;
          if (plain !== undefined || !tpl.includes("${")) {
            const key = join2(ns, plain ?? tpl);
            if (typeof at(key) !== "string" && !call[0].includes(".has")) missing.push(`${file}: ${key}`);
            continue;
          }
          // `Day.causes.${cause}`: the fixed part must be an existing group; the variable part is a code or an enum.
          const fixed = tpl.slice(0, tpl.indexOf("${"));
          const group = fixed.slice(0, fixed.lastIndexOf("."));
          if (group && typeof at(join2(ns, group)) !== "object") missing.push(`${file}: ${join2(ns, group)}.*`);
        }
      }
    }
  }
  expect(missing).toEqual([]);
});

it("every full key written as a string (messageKey, label tables) exists in fr.json", () => {
  const namespaces = new Set(Object.keys(fr));
  const missing = files.flatMap(({ file, text }) =>
    [...text.matchAll(/["`]([A-Za-z]+(?:\.\w+)+)["`]/g)]
      .map((m) => m[1])
      .filter((key) => namespaces.has(key.split(".")[0]) && typeof at(key) !== "string")
      .map((key) => `${file}: ${key}`),
  );
  expect(missing).toEqual([]);
});

it("every business error code has an errors.<CODE> message", () => {
  const codes = new Set<string>();
  for (const { text } of files) {
    for (const m of text.matchAll(/\b(?:fail\(\s*|error:\s*)"([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]);
    // Result<T, "A" | "B"> and the error unions behind it (`type PostError = EntryError | "PERIOD_LOCKED"`).
    for (const m of text.matchAll(/\bResult<[^;\n]*|\btype\s+\w*(?:Error|Code|Failure)\b[^=;]*=[^;]*/g))
      for (const c of m[0].matchAll(/"([A-Z][A-Z0-9_]+)"/g)) codes.add(c[1]);
  }
  const missing = [...codes].filter((c) => !(c in SILENT_CODES) && typeof at(`errors.${c}`) !== "string");
  expect(missing.sort()).toEqual([]);
  expect(codes.size).toBeGreaterThan(100); // the scan still finds the codes
});
