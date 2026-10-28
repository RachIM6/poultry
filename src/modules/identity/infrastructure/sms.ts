import { PhoneNumber } from "@/modules/identity/domain/phone-number";

// SMS / WhatsApp sender. The production provider is still open (SPEC OQ2); until then codes go to the server console.
// Production refuses the console sink unless OTP_CONSOLE_SINK=1, which only CI's e2e job sets.
export async function sendCode(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.OTP_CONSOLE_SINK !== "1") {
    throw new Error("No SMS provider configured (SPEC OQ2): refusing to print one-time codes in production.");
  }
  const masked = PhoneNumber.create(phone);
  console.info(`[dev OTP] ${masked.ok ? masked.value.masked : "?"} → ${code}`);
}
