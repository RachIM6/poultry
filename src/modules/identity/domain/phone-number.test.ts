import { describe, expect, it } from "vitest";
import { PhoneNumber } from "./phone-number";

const e164 = (raw: string) => {
  const r = PhoneNumber.create(raw);
  return r.ok ? r.value.e164 : r.error;
};

describe("PhoneNumber", () => {
  it("normalizes the ways Moroccan mobiles are written to E.164", () => {
    for (const raw of ["0612345678", "06 12 34 56 78", "06.12.34.56.78", "+212612345678", "00212612345678", "212612345678"]) {
      expect(e164(raw)).toBe("+212612345678");
    }
    expect(e164("0712345678")).toBe("+212712345678");
  });

  it("rejects landlines, other countries and malformed numbers (SMS pumping)", () => {
    for (const raw of ["0522123456", "+33612345678", "061234567", "06123456789", "", "abc"]) {
      expect(e164(raw)).toBe("INVALID_PHONE");
    }
  });

  it("masks the number for logs", () => {
    const r = PhoneNumber.create("0612345678");
    expect(r.ok && r.value.masked).toBe("+2126•••••78");
  });
});
