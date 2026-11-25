import { expect, it } from "vitest";
import { checkPassword, maskIdentifier, parseEmail, parseIdentifier } from "@/modules/identity/domain/identifier";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";

it("reads a phone in any spelling, or an email lowercased", () => {
  for (const raw of ["0612345678", "+212 6 12 34 56 78", "00212612345678"]) {
    expect(parseIdentifier(raw)).toMatchObject({ ok: true, value: { kind: "phone", phone: { e164: "+212612345678" } } });
  }
  expect(parseIdentifier("  Karim.B@Example.MA ")).toEqual({ ok: true, value: { kind: "email", email: "karim.b@example.ma" } });
  for (const raw of ["", "karim", "+33612345678", "a@b", "a b@c.ma", "212612345678@phone.invalid"]) {
    expect(parseIdentifier(raw), raw).toEqual({ ok: false, error: "INVALID_IDENTIFIER" });
  }
  expect(parseEmail("x@phone.invalid")).toEqual({ ok: false, error: "INVALID_EMAIL" }); // a phone-only account's placeholder
});

it("masks both kinds", () => {
  const phone = parseIdentifier("0612345678");
  const email = parseIdentifier("karim@example.ma");
  expect(phone.ok && maskIdentifier(phone.value)).toBe("+2126•••••78");
  expect(email.ok && maskIdentifier(email.value)).toBe("k•••@example.ma");
});

it("passwords: 10 to 128 characters, no composition rules, no obvious context", () => {
  expect(checkPassword("bab el had 2026")).toEqual({ ok: true, value: "bab el had 2026" });
  expect(checkPassword("abcdefghi")).toEqual({ ok: false, error: "PASSWORD_TOO_SHORT" });
  expect(checkPassword("x".repeat(129))).toEqual({ ok: false, error: "PASSWORD_TOO_LONG" });
  expect(checkPassword("é".repeat(10)).ok).toBe(false); // one character repeated
  const phone = PhoneNumber.create("0612345678");
  if (!phone.ok) throw new Error();
  for (const weak of ["aaaaaaaaaa", "1234567890", "0987654321", "azertyuiop", "Password2026", "motdepasse1", "06 12 34 56 78", "+212612345678", "karim@example.ma1", "karim.benali"]) {
    expect(checkPassword(weak, { phone: phone.value, email: weak.startsWith("karim.") ? "karim.benali@example.ma" : "karim@example.ma" }), weak).toEqual({ ok: false, error: "WEAK_PASSWORD" });
  }
  expect(checkPassword("passwords are long phrases").ok).toBe(true);
});
