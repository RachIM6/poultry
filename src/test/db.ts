import { beforeAll } from "vitest";
import { db } from "@/lib/db";

// Setup file for *.int.test.ts: every file starts from empty tables. Files run one at a time (vitest.config.ts).
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  // Names come from pg_catalog, not from input.
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

beforeAll(resetDb);
