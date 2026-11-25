import { fail, ok, type Result } from "@/lib/kernel/result";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";

// ADR-015: a user signs in with their phone number or their email. An email has an "@"; anything else is a phone.
export type Identifier = { kind: "phone"; phone: PhoneNumber } | { kind: "email"; email: string };

/** Trimmed, lowercased, one "@", a dot in the domain. `.invalid` is ours: the placeholder of a phone-only account. */
export function parseEmail(raw: string): Result<string, "INVALID_EMAIL"> {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith(".invalid") ? ok(email) : fail("INVALID_EMAIL");
}

export function parseIdentifier(raw: string): Result<Identifier, "INVALID_IDENTIFIER"> {
  if (raw.includes("@")) {
    const email = parseEmail(raw);
    return email.ok ? ok({ kind: "email", email: email.value }) : fail("INVALID_IDENTIFIER");
  }
  const phone = PhoneNumber.create(raw);
  return phone.ok ? ok({ kind: "phone", phone: phone.value }) : fail("INVALID_IDENTIFIER");
}

/** For logs and auth events: never a full number or address (law 09-08). */
export const maskIdentifier = (id: Identifier) => (id.kind === "phone" ? id.phone.masked : `${id.email[0]}•••@${id.email.split("@")[1]}`);

export const PASSWORD = { min: 10, max: 128 }; // ADR-015: NIST SP 800-63B lengths, no composition rules

// Sequences people type when asked for 10 characters (digits, French and English keyboard rows, the word itself).
const SEQUENCES = ["01234567890", "09876543210", "azertyuiop", "qwertyuiop", "motdepasse", "password"];

/**
 * ADR-015 password policy. Not a common-password list (none can be bundled without a download): only the
 * context-specific checks NIST asks for, a repeated character, a typed sequence, or the user's own phone or email.
 */
export function checkPassword(
  password: string,
  own: { phone?: PhoneNumber; email?: string } = {},
): Result<string, "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "WEAK_PASSWORD"> {
  if (password.length < PASSWORD.min) return fail("PASSWORD_TOO_SHORT");
  if (password.length > PASSWORD.max) return fail("PASSWORD_TOO_LONG");
  const lower = password.toLowerCase();
  const plain = lower.replace(/[\s.+-]/g, "");
  const phone = own.phone?.e164.slice(4); // 612345678: every spelling of the number contains it
  if (
    /^(.)\1*$/.test(plain) ||
    SEQUENCES.some((s) => s.includes(plain)) || // a run of digits or a keyboard row
    SEQUENCES.includes(plain.replace(/\d+$/, "")) || // password2024, azertyuiop1
    (phone && plain.includes(phone)) ||
    (own.email && (lower.includes(own.email) || lower === own.email.split("@")[0]))
  ) {
    return fail("WEAK_PASSWORD");
  }
  return ok(password);
}
