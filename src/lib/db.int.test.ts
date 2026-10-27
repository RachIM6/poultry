import { expect, test } from "vitest";
import { db } from "@/lib/db";

test("creates and reads an organisation in the reset test database", async () => {
  expect(await db.organization.count()).toBe(0);

  const { id } = await db.organization.create({ data: { name: "Ferme Test" } });

  expect(await db.organization.findUnique({ where: { id } })).toMatchObject({ name: "Ferme Test" });
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7 fallback default
});
