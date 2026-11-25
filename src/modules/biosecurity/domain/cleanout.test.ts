import { describe, expect, it } from "vitest";
import type { FarmDay } from "@/lib/kernel/farm-day";
import { checkStep, downtimeDay } from "./cleanout";

const d = (s: string) => s as FarmDay;

// SPEC-m2-compliance BS4–BS5, §8 fixtures. The placement warning is planning's (plan.test.ts).
describe("clean-out and downtime", () => {
  it("counts the downtime from the disinfection day, day 1 being that day", () => {
    expect(downtimeDay(d("2026-11-05"), d("2026-11-06"))).toBe(2);
    expect(downtimeDay(d("2026-11-05"), d("2026-11-05"))).toBe(1);
  });

  it("each step once; disinfection says with what", () => {
    const done = [{ step: "manureOut" as const }];
    expect(checkStep(done, { step: "manureOut", product: null })).toEqual({ ok: false, error: "STEP_ALREADY_DONE" });
    expect(checkStep(done, { step: "disinfection", product: null })).toEqual({ ok: false, error: "DISINFECTANT_REQUIRED" });
    expect(checkStep(done, { step: "disinfection", product: "Virkon S" }).ok).toBe(true);
    expect(checkStep(done, { step: "pressureWash", product: null }).ok).toBe(true); // out of order is fine
  });
});
