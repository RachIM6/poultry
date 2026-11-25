import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: new Date().toISOString() });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

describe("salary advances (SPEC-m4 WF10)", () => {
  let a: TenantContext, b: TenantContext;
  const [farm, said] = [uuidv7(), uuidv7()];
  const advance = (over: object = {}) => ({ id: uuidv7(), employeeId: said, day: "2026-11-04", amountCentimes: "100000", deductMonth: "2026-11", note: null, ...over });

  beforeAll(async () => {
    [a, b] = await twoTenants();
    await push(a, [
      m("farm-registry.createFarm", { id: farm, name: "F", region: "R", province: "P", commune: "C", gps: null, onssa: null }),
      m(M.createEmployee, { id: said, farmId: farm, name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-01", leftOn: null, dailyWageCentimes: "13846", cnssNumber: null, houseIds: [] }),
    ], registry);
  });

  it("a manager records an advance once, in integer centimes; owners and managers pull it, workers never", async () => {
    const x = advance();
    expect(await statuses({ ...a, role: "manager" }, [m(M.recordAdvance, x), m(M.recordAdvance, x)])).toEqual(["applied", "errors.ALREADY_EXISTS"]);
    expect(await db.salaryAdvance.findUniqueOrThrow({ where: { id: x.id } })).toMatchObject({ amountCentimes: 100000n, deductMonth: "2026-11", farmId: farm });
    expect((await pull(a, 0, registry)).changes.find((c) => c.id === x.id)?.data).toEqual({ ...x, farmId: farm });
    expect((await pull({ ...a, role: "worker" }, 0, registry)).changes.some((c) => c.entity === "advance")).toBe(false);
  });

  it("refuses workers, zero or decimal amounts, a deduction before the advance, and other organisations", async () => {
    expect(await statuses({ ...a, role: "worker" }, [m(M.recordAdvance, advance())])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(a, [m(M.recordAdvance, advance({ amountCentimes: "0" })), m(M.recordAdvance, advance({ amountCentimes: "10.5" }))])).toEqual(["errors.INVALID_INPUT", "errors.INVALID_INPUT"]);
    expect(await statuses(a, [m(M.recordAdvance, advance({ deductMonth: "2026-10" }))])).toEqual(["errors.INVALID_INPUT"]);
    expect(await statuses(b, [m(M.recordAdvance, advance())])).toEqual(["errors.NOT_FOUND"]);
  });
});
