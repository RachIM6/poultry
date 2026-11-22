import { beforeAll } from "vitest";
import { db } from "@/lib/db";

// Setup file for *.int.test.ts: every file starts from empty tables. Files run one at a time (vitest.config.ts).
// Only the tables holding rows are truncated: TRUNCATE costs about 70 ms per table on Docker Desktop (new files per
// table), so truncating all ~100 took 6-10 s per file and timed out the first hook. CASCADE still empties dependants.
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  // Names come from pg_catalog, not from input.
  const quoted = tables.map((t) => `"${t.tablename}"`);
  const filled = await db.$queryRawUnsafe<{ t: string }[]>(quoted.map((q) => `SELECT '${q}' AS t WHERE EXISTS (SELECT 1 FROM ${q})`).join(" UNION ALL "));
  if (filled.length > 0) await db.$executeRawUnsafe(`TRUNCATE ${filled.map((f) => f.t).join(", ")} CASCADE`);
}

beforeAll(resetDb);
