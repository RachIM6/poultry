import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { consume } from "@/lib/security/rate-limit";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";
import { auth, AUTH_CONFIG } from "@/modules/identity/infrastructure/better-auth";

type Net = { ip?: string; subnet?: string };
type LoginError = "INVALID_OR_EXPIRED_CODE" | "TOO_MANY_REQUESTS";

/**
 * Sends a code if the number is eligible. The answer never says whether a code went out (poultry-auth §0.9):
 * an invalid number, a per-number or a global block all look like success. Only an IP/subnet flood gets 429.
 */
export async function requestCode(rawPhone: string, net: Net): Promise<"sent_if_eligible" | "TOO_MANY_REQUESTS"> {
  const phone = PhoneNumber.create(rawPhone);
  const target = phone.ok ? { phone: phone.value.e164, prefix: phone.value.e164.slice(0, 7), global: "sms" } : {};
  const blocked = await consume("requestCode", { ...net, ...target });

  if (blocked.includes("ip") || blocked.includes("subnet")) return "TOO_MANY_REQUESTS";
  if (phone.ok && blocked.length === 0) await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone.value.e164 } });
  return "sent_if_eligible";
}

/** Checks the code and opens a session. Every failure is the same INVALID_OR_EXPIRED_CODE. */
export async function verifyCode(
  rawPhone: string,
  code: string,
  locale: "ar" | "fr",
  net: Net,
): Promise<Result<Headers, LoginError>> {
  const phone = PhoneNumber.create(rawPhone);
  const blocked = await consume("verifyCode", { ...net, ...(phone.ok ? { phone: phone.value.e164 } : {}) });
  if (blocked.length > 0) return fail("TOO_MANY_REQUESTS");
  if (!phone.ok || !/^\d{6}$/.test(code)) return fail("INVALID_OR_EXPIRED_CODE");

  try {
    const { headers, response } = await auth.api.verifyPhoneNumber({
      body: { phoneNumber: phone.value.e164, code },
      returnHeaders: true,
    });
    // SPEC I3: the language used to log in is the user's current choice. (Better Auth drops extra body fields.)
    await db.user.update({ where: { id: response.user.id }, data: { locale } });
    return ok(headers);
  } catch {
    return fail("INVALID_OR_EXPIRED_CODE");
  }
}

/** The signed-in user, or null. Enforces the 90-day absolute cap on top of Better Auth's 30-day sliding expiry. */
export async function getSession(headers: Headers, clock: Clock = systemClock) {
  const current = await auth.api.getSession({ headers });
  if (!current) return null;
  const ageSec = (clock.now().getTime() - current.session.createdAt.getTime()) / 1000;
  if (ageSec > AUTH_CONFIG.session.absoluteMaxSec) {
    await db.session.deleteMany({ where: { id: current.session.id } });
    return null;
  }
  return { userId: current.user.id, phone: current.user.phoneNumber, locale: current.user.locale };
}

/** Deletes the server session; the returned headers clear the cookie. */
export async function logout(headers: Headers): Promise<Headers> {
  try {
    const { headers: out } = await auth.api.signOut({ headers, returnHeaders: true });
    return out;
  } catch {
    return new Headers(); // no session to end: logging out is already done
  }
}
