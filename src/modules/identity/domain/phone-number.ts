import { fail, ok, type Result } from "@/lib/kernel/result";

// The login identifier. Moroccan mobiles only (+2126 / +2127): codes cost money, so no other range gets one.
export class PhoneNumber {
  private constructor(readonly e164: string) {}

  static create(raw: string): Result<PhoneNumber, "INVALID_PHONE"> {
    const m = /^(?:\+212|00212|212|0)([67]\d{8})$/.exec(raw.replace(/[\s.-]/g, ""));
    return m ? ok(new PhoneNumber(`+212${m[1]}`)) : fail("INVALID_PHONE");
  }

  /** For logs: never log a full number. */
  get masked() {
    return `${this.e164.slice(0, 5)}•••••${this.e164.slice(-2)}`;
  }
}
