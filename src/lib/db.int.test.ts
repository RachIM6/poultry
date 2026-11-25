import { expect, test } from "vitest";
import { db } from "@/lib/db";

test("creates and reads an organisation in the reset test database", async () => {
  expect(await db.organization.count()).toBe(0);

  const { id } = await db.organization.create({ data: { name: "Ferme Test" } });

  expect(await db.organization.findUnique({ where: { id } })).toMatchObject({ name: "Ferme Test" });
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7 fallback default
});

// Supabase's Data API would serve any table without RLS to the public anon key (migration *_row_level_security).
test("every table has row level security on, so a new migration can't expose one", async () => {
  const open = await db.$queryRaw<{ relname: string }[]>`
    SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = current_schema()::regnamespace AND NOT relrowsecurity`;
  expect(open.map((t) => t.relname)).toEqual([]);
});
