import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// docs/data-requests.md: a left organisation is read-only. Server actions and write route handlers take their context
// from getWriteContext, which refuses it; getTenantContext would let the write through. A text scan of src.

/** Writes that may use getTenantContext, and why. */
const ALLOWED: Record<string, string> = {
  "app/api/sync/push/route.ts": "refuses each mutation of a left organisation in lib/sync/server.ts decide(), so the phone lists it",
  "app/api/notifications/quiet-hours/route.ts": "the member's own quiet hours, not the organisation's data",
  "app/api/push/subscribe/route.ts": "the member's own device subscription, not the organisation's data",
  "app/api/notifications/test/route.ts": "a test push to the member's own devices; writes no organisation data",
};

const src = fileURLToPath(new URL("..", import.meta.url));
const files = (readdirSync(src, { recursive: true }) as string[])
  .map((f) => relative(src, join(src, f)).replaceAll("\\", "/"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("generated/"))
  .map((f) => ({ file: f, text: readFileSync(join(src, f), "utf8").replace(/(?<=^|\s)\/\/.*$/gm, "") })); // comments out

const isServerAction = (text: string) => /^\s*["']use server["']/.test(text);
const isWriteRoute = (file: string, text: string) =>
  /^app\/api\/.*\/route\.ts$/.test(file) && /export\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/.test(text);

it("server actions and write route handlers take their context from getWriteContext", () => {
  const writes = files.filter(({ file, text }) => isServerAction(text) || isWriteRoute(file, text));
  expect(writes.length).toBeGreaterThan(15); // the scan still finds them
  const offenders = writes.filter(({ file, text }) => /\bgetTenantContext\s*\(/.test(text) && !(file in ALLOWED)).map((f) => f.file);
  expect(offenders).toEqual([]);
});

it("keeps the allowlist to files that still exist and still need it", () => {
  for (const file of Object.keys(ALLOWED)) expect(files.find((f) => f.file === file)?.text, file).toMatch(/\bgetTenantContext\s*\(/);
});
