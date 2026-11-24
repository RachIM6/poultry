import { describe, expect, it } from "vitest";
import { pulls } from "./views";

describe("pulls (SPEC-m5 §5)", () => {
  it("gives staff every entity and partners only their view", () => {
    for (const role of ["owner", "manager", "worker"] as const) expect(pulls(role, "climateReading")).toBe(true);
    expect(pulls("vet", "dailyEntry")).toBe(true);
    expect(pulls("vet", "sale")).toBe(false);
    expect(pulls("accountant", "sale")).toBe(true);
    expect(pulls("accountant", "dailyEntry")).toBe(false);
    expect(pulls("accountant", "aNewEntity")).toBe(false); // fails closed
  });
});
