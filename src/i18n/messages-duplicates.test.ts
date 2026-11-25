import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// JSON.parse keeps the last of two equal keys without a word, so a new message can silently replace another one
// (Batches.bySex once renamed the turkey placement's "Sexes séparés"). This reads the files as text instead.
function duplicateKeys(text: string): string[] {
  const stack: (Set<string> | null)[] = []; // one key set per open object; null for an array
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") stack.push(new Set());
    else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const key = JSON.parse(text.slice(i, end + 1)) as string;
      const keys = stack.at(-1);
      if (keys && /^\s*:/.test(text.slice(end + 1, end + 20))) {
        if (keys.has(key)) found.push(`${key} (line ${text.slice(0, i).split("\n").length})`);
        keys.add(key);
      }
      i = end;
    }
  }
  return found;
}

it("finds a key repeated in the same object only", () => {
  expect(duplicateKeys('{"a": {"b": "x", "c": "b"}, "b": ["a", {"a": 1}], "d": "{\\"a\\": 1}", "a": 2}')).toEqual(["a (line 1)"]);
});

it.each(["fr", "ar"])("messages/%s.json has no key twice in the same object", (locale) => {
  expect(duplicateKeys(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"))).toEqual([]);
});
