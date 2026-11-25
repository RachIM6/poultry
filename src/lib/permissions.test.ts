import { describe, expect, it } from "vitest";
import { can, withoutMoney, type Action } from "./permissions";
import type { Role } from "./tenant";

const as = (role: Role) => ({ userId: "u", organizationId: "o", role });

describe("can (SPEC I5)", () => {
  it("lets every role read the organisation", () => {
    for (const role of ["owner", "manager", "worker"] as const) expect(can(as(role), "organization.read")).toBe(true);
  });

  it("keeps organisation settings and members to the owner", () => {
    for (const action of ["organization.manage", "members.manage"] as const) {
      expect(can(as("owner"), action)).toBe(true);
      expect(can(as("manager"), action)).toBe(false);
      expect(can(as("worker"), action)).toBe(false);
    }
  });

  it("lets owners and managers manage farms, not workers", () => {
    expect(can(as("owner"), "farms.manage")).toBe(true);
    expect(can(as("manager"), "farms.manage")).toBe(true);
    expect(can(as("worker"), "farms.manage")).toBe(false);
  });
});

describe("partners (SPEC-m5 §5, ADR-013)", () => {
  const ACTIONS: Action[] = [
    "organization.read", "organization.manage", "members.manage", "farms.manage", "protocols.manage", "stock.manage", "flock.manage", "flock.record",
    "health.manage", "health.record", "sales.manage", "money.read", "finance.record", "finance.manage", "workforce.manage", "workforce.record",
    "workforce.validatePay", "labour.manage", "climate.record", "climate.manage", "prices.record",
  ];
  const allowed = (role: Role) => ACTIONS.filter((a) => can(as(role), a));

  it("a vet does the farm's health work and sees no money", () => {
    expect(allowed("vet")).toEqual(["organization.read", "protocols.manage", "health.manage", "health.record"]);
  });

  it("an accountant reads money and writes nothing", () => {
    expect(allowed("accountant")).toEqual(["organization.read", "money.read"]);
  });

  it("an accountant's view keeps money, a vet's drops it", () => {
    const dto = { id: "s1", amountCentimes: "100" };
    expect(withoutMoney(as("accountant"), dto, ["amountCentimes"])).toEqual(dto);
    expect(withoutMoney(as("vet"), dto, ["amountCentimes"])).toEqual({ id: "s1" });
  });
});

describe("withoutMoney (SPEC I5)", () => {
  type SaleDto = { id: string; birds: number; amountCentimes?: string; pricePerKgCentimes?: string };
  const sale: SaleDto = { id: "s1", birds: 500, amountCentimes: "1234500", pricePerKgCentimes: "1450" };
  const money = ["amountCentimes", "pricePerKgCentimes"] as const;

  it("sends a worker no money field at all, not even an empty one", () => {
    const json = JSON.stringify(withoutMoney(as("worker"), sale, money));
    expect(JSON.parse(json)).toEqual({ id: "s1", birds: 500 });
    expect(json).not.toMatch(/amount|price/i);
  });

  it("keeps money for owners and managers, and never mutates the input", () => {
    expect(withoutMoney(as("owner"), sale, money)).toEqual(sale);
    expect(withoutMoney(as("manager"), sale, money)).toEqual(sale);
    withoutMoney(as("worker"), sale, money);
    expect(sale.amountCentimes).toBe("1234500");
  });
});
