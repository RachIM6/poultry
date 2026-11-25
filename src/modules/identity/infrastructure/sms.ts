import { PhoneNumber } from "@/modules/identity/domain/phone-number";

/**
 * ADR-015: SMS code login is off unless AUTH_SMS_ENABLED=true. Off, the code endpoints answer 404 and the login screen
 * offers passwords only; this sender, OTP_CONSOLE_SINK and the SMS-cost cap are dormant.
 */
export const smsEnabled = () => process.env.AUTH_SMS_ENABLED === "true";

// SMS / WhatsApp sender. The production provider is still open (SPEC OQ2); until then codes go to the server console.
// Production refuses the console sink unless OTP_CONSOLE_SINK=1, which only the e2e server sets (and the startup check
// in src/lib/env.ts refuses it outside that test server).
export async function sendCode(phone: string, code: string): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.OTP_CONSOLE_SINK !== "1") {
    throw new Error("No SMS provider configured (SPEC OQ2): refusing to print one-time codes in production.");
  }
  const masked = PhoneNumber.create(phone);
  console.info(`[dev OTP] ${masked.ok ? masked.value.masked : "?"} → ${code}`);
}
