import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import type { Role } from "./tenant";

const as = (role: Role) => ({ userId: "u", organizationId: "o", role });

describe("can (SPEC I5)", () => {
  it("lets every role read the organisation", () => {
    for (const role of ["owner", "manager", "worker"] as const) expect(can(as(role), "organization.read")).toBe(true);
  });

  it("keeps organisation settings to the owner", () => {
    expect(can(as("owner"), "organization.manage")).toBe(true);
    expect(can(as("manager"), "organization.manage")).toBe(false);
    expect(can(as("worker"), "organization.manage")).toBe(false);
  });
});
