import { describe, expect, it } from "vitest";
import { accountingProfileOf, LEGAL_FORMS, parseOnboarding } from "./schema";

describe("accountingProfileOf (SPEC F1)", () => {
  it.each([
    ["individual", "cash_book", false],
    ["indivision", "cash_book", true],
    ["company", "pcge", false],
    ["gie", "pcge", false],
    ["cooperative", "cooperative", false],
    ["association", "association", false],
  ] as const)("%s → %s", (form, chart, coOwnerShares) => {
    expect(accountingProfileOf(form)).toEqual({ chart, coOwnerShares });
  });

  it("covers the 6 forms of the spec", () => {
    expect(LEGAL_FORMS).toHaveLength(6);
  });
});

describe("parseOnboarding", () => {
  it("trims the name and keeps a valid form and locale", () => {
    expect(parseOnboarding({ name: "  Ferme El Kheir ", form: "indivision", locale: "fr" })).toEqual({
      ok: true,
      value: { name: "Ferme El Kheir", form: "indivision", locale: "fr" },
    });
  });

  it.each([
    ["no body", null],
    ["blank name", { name: "   ", form: "company", locale: "ar" }],
    ["name too long", { name: "x".repeat(121), form: "company", locale: "ar" }],
    ["unknown form", { name: "Ferme", form: "sarl", locale: "ar" }],
    ["unknown locale", { name: "Ferme", form: "company", locale: "ary" }],
    ["form from the prototype", { name: "Ferme", form: "toString", locale: "ar" }],
  ])("rejects %s", (_, body) => {
    expect(parseOnboarding(body)).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
