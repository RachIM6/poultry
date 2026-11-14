import { describe, expect, it } from "vitest";
import { accountingProfileOf, LEGAL_FORMS, parseOnboarding } from "./schema";

describe("accountingProfileOf (SPEC F1, SPEC-finance FN1, ADR-010 §2)", () => {
  it.each([
    ["individual", "cash_book", "cgnc", ["pca"], false],
    ["indivision", "cash_book", "cgnc", ["pca"], true],
    ["company", "ledger", "cgnc", ["pca"], false],
    ["gie", "ledger", "cgnc", ["pca"], false],
    ["cooperative", "cash_book", "cgnc", ["pca"], false], // until FQ2 gives the cooperative chart: ledger + coop then
    ["association", "cash_book", "cgnc", [], false],
  ] as const)("%s → %s, %s + %j", (form, books, base, overlays, coOwnerShares) => {
    expect(accountingProfileOf(form)).toEqual({ books, base, overlays, coOwnerShares });
  });

  it("applies the owner's choices: books, and the PCA overlay on or off", () => {
    expect(accountingProfileOf("individual", { books: "ledger", pcaOverlay: null })).toMatchObject({ books: "ledger", overlays: ["pca"] }); // FQ6
    expect(accountingProfileOf("company", { books: null, pcaOverlay: false })).toMatchObject({ books: "ledger", overlays: [] });
    expect(accountingProfileOf("association", { books: null, pcaOverlay: true })).toMatchObject({ overlays: ["pca"] });
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
