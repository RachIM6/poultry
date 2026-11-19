import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import { registry } from "@/app/api/sync/registry";
import { db } from "@/lib/db";
import type { PushedMutation } from "@/lib/sync/protocol";
import { pull, push } from "@/lib/sync/server";
import type { TenantContext } from "@/lib/tenant";
import { WORKFORCE_MUTATIONS as M } from "@/modules/workforce/schema";
import { twoTenants } from "@/test/tenant";

const m = (type: string, payload: unknown): PushedMutation => ({ id: uuidv7(), type, payload, createdAt: "2026-11-17T09:00:00+01:00" });
const statuses = async (ctx: TenantContext, ms: PushedMutation[]) =>
  (await push(ctx, ms, registry)).results.map((r) => (r.status === "rejected" ? r.messageKey : r.status));

const fields = { name: "Said A.", job: "worker", phone: null, housedOnFarm: true, startedOn: "2026-01-05", leftOn: null, dailyWageCentimes: "13846", cnssNumber: "123456789", houseIds: [] as string[] };

describe("employees through sync (SPEC-m4 WF1–WF3)", () => {
  let a: TenantContext, b: TenantContext;
  let farmId: string, houseId: string;
  beforeAll(async () => {
    [a, b] = await twoTenants();
    [farmId, houseId] = [uuidv7(), uuidv7()];
    const farm = { id: farmId, name: "El Kheir", region: "Casablanca-Settat", province: "Settat", commune: "Ben Ahmed", gps: null, onssa: null };
    await push(a, [m("farm-registry.createFarm", farm), m("farm-registry.createHouse", { id: houseId, farmId, name: "Bât. 2", areaM2: 1000, capacity: 10000, type: "closed" })], registry);
  });

  it("an employee pushed by a manager reaches owners whole, and workers without wage, phone or CNSS number", async () => {
    const id = uuidv7();
    const manager = { ...a, role: "manager" as const };
    expect(await statuses(manager, [m(M.createEmployee, { id, farmId, ...fields, phone: "06 12 34 56 78", houseIds: [houseId] })])).toEqual(["applied"]);

    const own = (await pull(a, 0, registry)).changes.find((c) => c.id === id)?.data;
    expect(own).toMatchObject({ name: "Said A.", phone: "+212612345678", dailyWageCentimes: "13846", cnssNumber: "123456789", houseIds: [houseId], userId: null });
    const seen = (await pull({ ...a, role: "worker" }, 0, registry)).changes.find((c) => c.id === id)?.data as object;
    expect(seen).toMatchObject({ name: "Said A.", houseIds: [houseId] });
    expect(Object.keys(seen)).not.toContain("dailyWageCentimes");
    expect(Object.keys(seen)).not.toContain("cnssNumber");
    expect(Object.keys(seen)).not.toContain("phone");
  });

  it("refuses workers, other organisations, foreign houses and a left date before the start", async () => {
    const id = uuidv7();
    expect(await statuses({ ...a, role: "worker" }, [m(M.createEmployee, { id, farmId, ...fields })])).toEqual(["errors.FORBIDDEN"]);
    expect(await statuses(b, [m(M.createEmployee, { id, farmId, ...fields })])).toEqual(["errors.NOT_FOUND"]);
    expect(await statuses(a, [m(M.createEmployee, { id, farmId, ...fields, leftOn: "2025-12-31" })])).toEqual(["errors.LEFT_BEFORE_START"]);
    expect(await statuses(a, [m(M.createEmployee, { id, farmId, ...fields, phone: "0512" })])).toEqual(["errors.INVALID_PHONE"]);

    expect(await statuses(a, [m(M.createEmployee, { id, farmId, ...fields })])).toEqual(["applied"]);
    expect(await statuses(b, [m(M.updateEmployee, { id, changes: { name: "pris" } })])).toEqual(["errors.NOT_FOUND"]);
    const otherHouse = uuidv7();
    const otherFarm = uuidv7();
    await push(b, [m("farm-registry.createFarm", { id: otherFarm, name: "B", region: "r", province: "p", commune: "c", gps: null, onssa: null }), m("farm-registry.createHouse", { id: otherHouse, farmId: otherFarm, name: "x", areaM2: 1, capacity: 1, type: "open" })], registry);
    expect(await statuses(a, [m(M.updateEmployee, { id, changes: { houseIds: [otherHouse] } })])).toEqual(["errors.NOT_FOUND"]);
    expect((await pull(b, 0, registry)).changes.some((c) => c.id === id)).toBe(false);
  });

  it("links the member who signs in with the employee's phone, once per farm; marking as left is audited", async () => {
    const user = await db.user.create({ data: { phoneNumber: "+212698765432", name: "Khalid", email: "khalid@phone.invalid" } });
    await db.membership.create({ data: { organizationId: a.organizationId, userId: user.id, role: "worker" } });
    const [first, second] = [uuidv7(), uuidv7()];
    const replayed = m(M.createEmployee, { id: first, farmId, ...fields, name: "Khalid L.", phone: "0698765432" });
    expect(await statuses(a, [replayed, replayed])).toEqual(["applied", "applied"]);
    expect(await db.employee.count({ where: { id: first } })).toBe(1);
    expect(await db.employee.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ userId: user.id, phone: "+212698765432" });

    expect(await statuses(a, [m(M.createEmployee, { id: second, farmId, ...fields, phone: "+212698765432" })])).toEqual(["errors.MEMBER_ALREADY_LINKED"]);

    const left = m(M.updateEmployee, { id: first, changes: { leftOn: "2026-11-15" } });
    expect(await statuses(a, [left])).toEqual(["applied"]);
    expect(await db.auditEvent.findFirstOrThrow({ where: { mutationId: left.id } })).toMatchObject({ entity: "Employee", action: "update", before: { leftOn: null }, after: { leftOn: "2026-11-15" } });
  });
});
