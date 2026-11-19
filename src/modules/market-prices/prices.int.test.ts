import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import { farmDayOf, nextFarmDay } from "@/lib/kernel/farm-day";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { PRICE_MUTATIONS as M } from "@/modules/market-prices/schema";
import { twoTenants } from "@/test/tenant";

// SPEC-m5 MP1, MP3 (T94): a price is recorded once, in integer centimes; workers and vets never see prices.
const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) => (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("price log (SPEC-m5 MP1, MP3)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => ([a, b] = await twoTenants()));
  const price = (over: object = {}) => ({ id: uuidv7(), product: "liveBroiler", day: "2026-11-12", priceCentimes: "1400", seenOn: "Souk de Had Soualem", ...over });

  it("a manager records a price once; owners, managers and accountants pull it; workers and vets never", async () => {
    const x = price();
    expect(await statuses({ ...a, role: "manager" }, [m(M.recordPrice, x), m(M.recordPrice, x)])).toEqual(["applied", "errors.ALREADY_EXISTS"]);
    expect(await db.priceObservation.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ priceCentimes: 1400n, product: "liveBroiler" });
    const dto = { ...x, byUserId: a.userId };
    expect((await pull(a, 0, registry)).changes.find((c) => c.id === x.id)?.data).toEqual(dto);
    expect((await pull({ ...a, role: "accountant" }, 0, registry)).changes.find((c) => c.id === x.id)?.data).toEqual(dto);
    for (const role of ["worker", "vet"] as const) expect((await pull({ ...a, role }, 0, registry)).changes.some((c) => c.entity === "price")).toBe(false);
    expect((await pull(b, 0, registry)).changes.some((c) => c.entity === "price")).toBe(false);
  });

  it("refuses workers and accountants, a zero or decimal price, an unknown product and a day ahead", async () => {
    for (const role of ["worker", "accountant", "vet"] as const) expect(await statuses({ ...a, role }, [m(M.recordPrice, price())])).toEqual(["errors.FORBIDDEN"]);
    expect(
      await statuses(a, [m(M.recordPrice, price({ priceCentimes: "0" })), m(M.recordPrice, price({ priceCentimes: "14.5" })), m(M.recordPrice, price({ product: "goat" }))]),
    ).toEqual(["errors.INVALID_INPUT", "errors.INVALID_INPUT", "errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.recordPrice, price({ day: nextFarmDay(nextFarmDay(farmDayOf(new Date()))) }))])).toEqual(["errors.DAY_IN_FUTURE"]);
  });
});
