import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingRequiredVaccines, REQUIRED_VACCINES } from "@/modules/health/domain/required";

// Module level, not domain/: it reads the committed catalogue (prisma/seed/reference/products.json).
const [newcastle] = REQUIRED_VACCINES;
const products: { id: string; kind: string }[] = JSON.parse(readFileSync(new URL("../../../prisma/seed/reference/products.json", import.meta.url), "utf8"));

describe("required vaccines (OQ4: arrêté n° 3308-17, art. 13)", () => {
  it("requires Newcastle, a vaccine of the committed catalogue", () => {
    expect(REQUIRED_VACCINES.map((r) => r.disease)).toEqual(["newcastle"]);
    expect(products.find((p) => p.id === newcastle.productId)?.kind).toBe("vaccine");
    expect(newcastle.source).toBe("Arrêté n° 3308-17, art. 13");
  });

  it("finds Newcastle missing from an empty protocol or a plan without it", () => {
    expect(missingRequiredVaccines([])).toEqual([newcastle]);
    expect(missingRequiredVaccines([{ productId: "vaccine-gumboro" }, { productId: "vaccine-infectious-bronchitis" }])).toEqual([newcastle]);
  });

  it("is satisfied by any Newcastle line", () => {
    expect(missingRequiredVaccines([{ productId: "vaccine-gumboro" }, { productId: "vaccine-newcastle" }])).toEqual([]);
  });
});
