import { describe, expect, it } from "vitest";
import { can, withoutMoney } from "./permissions";
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
