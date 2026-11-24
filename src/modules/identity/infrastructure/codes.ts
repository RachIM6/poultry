import { createHmac, randomInt } from "node:crypto";

// ADR-015: one-time invite and reset codes. 8 characters from 31 that can't be misread (no 0 O 1 I L), ~40 bits,
// read aloud or sent by WhatsApp. Only their HMAC is stored (key BETTER_AUTH_SECRET), so a database read alone
// neither shows a code nor lets one be brute-forced offline. The purpose is in the HMAC: a reset code never opens an
// invitation.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 8;

export type CodePurpose = "invite" | "reset";

/** A new code, shown once, as "ABCD-EFGH". */
export function newCode(): string {
  const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** What was typed, as stored: upper case, without spaces or dashes. Null when it can't be a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export function codeHash(purpose: CodePurpose, code: string): string {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) throw new Error("BETTER_AUTH_SECRET is not set.");
  return createHmac("sha256", key).update(`${purpose}:${code.replace("-", "")}`).digest("hex");
}
