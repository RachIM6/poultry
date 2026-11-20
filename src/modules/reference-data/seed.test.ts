import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EggGrade, Product, ProtocolTemplate } from "./schema";
import { PRODUCTION_TYPES } from "./shared";

// SPEC-m3 §4: reference values come from a named source document, or stay empty. This guards the committed seed.
const seed = (file: string) => JSON.parse(readFileSync(new URL(`../../../prisma/seed/reference/${file}`, import.meta.url), "utf8"));

describe("committed reference seed (SPEC-m3 §4)", () => {
  it("has no egg grade limit (MQ2)", () => {
    const grades = (seed("egg-grades.json") as unknown[]).map((g) => EggGrade.parse(g));
    expect(grades.map((g) => g.label)).toEqual(["S", "M", "L", "XL"]);
    expect(grades.every((g) => g.minGrams === null && g.maxGrams === null)).toBe(true);
  });

  it("has one empty, unreviewed protocol template per production type (MQ3, OQ4)", () => {
    const templates = (seed("protocols.json") as unknown[]).map((t) => ProtocolTemplate.parse(t));
    expect(templates.map((t) => t.productionType).sort()).toEqual([...PRODUCTION_TYPES].sort());
    expect(templates.every((t) => t.items.length === 0 && !t.reviewedByVet)).toBe(true);
  });

  it("has no withdrawal period, for meat or eggs (MQ4)", () => {
    const products = (seed("products.json") as unknown[]).map((p) => Product.parse(p));
    expect(products.every((p) => p.withdrawalDays === null && p.eggWithdrawalDays === null)).toBe(true);
  });

  it("has no curve value (MQ1)", () => {
    for (const dir of ["curves", "laying"]) {
      expect(readdirSync(new URL(`../../../prisma/seed/reference/${dir}/`, import.meta.url)).filter((f) => f.endsWith(".json"))).toEqual([]);
    }
  });
});
