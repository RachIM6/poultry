import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { _createCache, _createIntlFormatters } from "next-intl";
import { expect, it } from "vitest";

// next.config.ts turns on next-intl's experimental `precompile`: the screens get messages compiled by the plugin's
// catalog loader (icu-minify) and format them with use-intl's format-only, while server code and tests parse them with
// intl-messageformat. This checks both give the same text for every message, each select option and plural branch.
// The two formatters live in use-intl, which pnpm keeps out of our node_modules, so they are resolved from next-intl,
// as the plugin itself does; the loader runs as-is with a minimal loader context.
type Format = (key: string, message: unknown, values: Values, options: object) => unknown;
type Values = Record<string, unknown>;
type Tree = Record<string, unknown>;

const loaderPath = createRequire(import.meta.url).resolve("next-intl/extractor/catalogLoader");
const load = async (path: string): Promise<{ default: unknown }> =>
  import(pathToFileURL(createRequire(loaderPath).resolve(path)).href);
const catalogLoader = (await import(pathToFileURL(loaderPath).href)).default as (this: object, source: string) => void;
const fullFormat = (await load("use-intl/format-message")).default as Format;
const precompiledFormat = (await load("use-intl/format-message/format-only")).default as Format;

const precompile = (file: string) =>
  new Promise<Tree>((resolve, reject) => {
    catalogLoader.call(
      {
        getOptions: () => ({ messages: { format: "json", precompile: true } }),
        async: () => (error: Error | null, code: string) =>
          error ? reject(error) : resolve(JSON.parse(JSON.parse(code.slice("export default JSON.parse(".length, -2)))),
        resourcePath: file,
        rootContext: process.cwd(),
      },
      readFileSync(file, "utf8"),
    );
  });

const leaves = (tree: Tree, prefix = ""): [string, unknown][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? leaves(v as Tree, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
const at = (tree: Tree, key: string) => key.split(".").reduce<unknown>((node, k) => (node as Tree)[k], tree);

const NUMBERS = [0, 1, 2, 3, 5, 11, 21, 100, 1.5, 1234567.25];
const DATE = new Date("2026-03-01T23:30:00Z");

// Candidate values per argument, read from the compiled tree (shapes as in use-intl's format-only.js):
// a list is string | 0 (#) | node[]; a node is [arg] | [arg, 1 select | 2 plural | 3 selectordinal | 4 number |
// 5 date | 6 time, ...] | [tag, ...children].
function collect(list: unknown, args: Map<string, Set<unknown>>) {
  if (!Array.isArray(list)) return;
  for (const node of list) {
    if (!Array.isArray(node)) continue;
    const [name, type, options] = node as [string, unknown, unknown];
    const add = (...values: unknown[]) => values.forEach((v) => args.set(name, (args.get(name) ?? new Set()).add(v)));
    if (type === undefined) add(`‹${name}›`);
    else if (typeof type !== "number" || type === 0) {
      add((chunks: unknown) => `<${name}>${[chunks].flat().join("")}</${name}>`);
      collect(node.slice(1), args);
    } else if (type <= 3) {
      const branches = options as Tree;
      if (type === 1) add(...Object.keys(branches), "zz-unknown");
      else add(...NUMBERS, ...Object.keys(branches).filter((k) => k.startsWith("=")).map((k) => Number(k.slice(1))));
      Object.values(branches).forEach((branch) => collect(branch, args));
    } else add(...(type === 4 ? NUMBERS : [DATE]));
  }
}

// Every combination of the candidates. ponytail: cross product, fine while messages have a few branching arguments.
const combinations = (args: Map<string, Set<unknown>>) =>
  [...args].reduce<Values[]>((acc, [name, values]) => acc.flatMap((v) => [...values].map((x) => ({ ...v, [name]: x }))), [{}]);

const attempt = (fn: () => unknown) => {
  try {
    return fn();
  } catch (error) {
    return `throws: ${(error as Error).message}`;
  }
};

it("precompiled messages format like the ICU parser in ar and fr", async () => {
  const cache = _createCache();
  const formatters = _createIntlFormatters(cache);
  const mismatches: unknown[] = [];
  let cases = 0;
  for (const locale of ["ar", "fr"]) {
    const file = `messages/${locale}.json`;
    const compiled = await precompile(file);
    const options = { cache, formatters, locale, timeZone: "Africa/Casablanca" };
    for (const [key, raw] of leaves(JSON.parse(readFileSync(file, "utf8")) as Tree)) {
      const message = at(compiled, key);
      const args = new Map<string, Set<unknown>>();
      collect(message, args);
      for (const values of combinations(args)) {
        cases++;
        const full = attempt(() => fullFormat(key, raw, values, options));
        const precompiled = attempt(() => precompiledFormat(key, message, values, options));
        if (full !== precompiled) mismatches.push({ locale, key, values, full, precompiled });
      }
    }
  }
  expect(mismatches).toEqual([]);
  expect(cases).toBeGreaterThan(3000);
});
