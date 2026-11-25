import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

// prisma/migrations/20261124230000_egg_draw_sale_day: a draw's day is its sale's farm day, not when the server got it.
const migration = readFileSync(new URL("../../../prisma/migrations/20261124230000_egg_draw_sale_day/migration.sql", import.meta.url), "utf8");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("egg draw day backfill", () => {
  it("moves each draw to its sale's day and leaves the others", async () => {
    const org = uuidv7(), other = uuidv7(), batchId = uuidv7(), farmId = uuidv7();
    const sale = (id: string, organizationId: string, d: string) =>
      db.sale.create({
        data: { id, organizationId, batchId, day: day(d), birds: 0, farmWeightGrams: 0, pricePerKgCentimes: 0n, amountCentimes: 0n, paymentMethod: "cash", paidCentimes: 0n, kind: "eggs", recordedBy: uuidv7() },
      });
    const draw = (organizationId: string, saleId: string, d: string) =>
      db.eggDraw.create({ data: { id: uuidv7(), organizationId, farmId, batchId, saleId, laidOn: day("2026-11-18"), item: "ungraded", eggs: 30, day: day(d) } });
    const [late, right, foreign] = [uuidv7(), uuidv7(), uuidv7()];
    await sale(late, org, "2026-11-20"); // recorded offline on the 20th, synced on the 22nd
    await sale(right, org, "2026-11-21");
    await sale(foreign, other, "2026-11-19");
    const moved = await draw(org, late, "2026-11-22");
    const kept = await draw(org, right, "2026-11-21");
    const otherOrg = await draw(org, foreign, "2026-11-23"); // a sale id of another organisation: not this draw's sale

    expect(await db.$executeRawUnsafe(migration)).toBe(1);

    const dayOf = async (id: string) => (await db.eggDraw.findUniqueOrThrow({ where: { id } })).day.toISOString().slice(0, 10);
    expect([await dayOf(moved.id), await dayOf(kept.id), await dayOf(otherOrg.id)]).toEqual(["2026-11-20", "2026-11-21", "2026-11-23"]);
  });
});
