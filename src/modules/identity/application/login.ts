import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { verifyCaptcha } from "@/lib/security/captcha";
import { clientNet, consume, reset } from "@/lib/security/rate-limit";
import type { PolicyName } from "@/lib/security/policies";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";
import { acceptInvitations } from "@/modules/identity/application/members";
import { auditPartnerSignIn } from "@/modules/identity/application/membership"; // and it uses getSession: called at run time only
import { recordAuthEvent, type AuthAction, type Client } from "@/modules/identity/infrastructure/auth-events";
import { auth, AUTH_CONFIG } from "@/modules/identity/infrastructure/better-auth";

type LoginError = "INVALID_OR_EXPIRED_CODE" | "TOO_MANY_REQUESTS" | "CAPTCHA_REQUIRED";

/** The request's IP (for the limits), coarse subnet and user agent (for the auth events, poultry-auth §6). */
export const clientOf = (headers: Headers): Client => ({ ...clientNet(headers), userAgent: headers.get("user-agent") ?? undefined });

// Every path below writes exactly one auth event, so auditing adds the same work to each answer (poultry-auth §0.9).
const eventFor = (client: Client, phone: ReturnType<typeof PhoneNumber.create>) => (action: AuthAction, reason: string) =>
  recordAuthEvent(action, client, { reason, phone: phone.ok ? phone.value.masked : undefined });
const blockedOn = (policy: PolicyName, dims: string[]) => `${policy}:${dims.join(",")}`;

// Better Auth's error code, kept for the audit only: the answer is always INVALID_OR_EXPIRED_CODE.
const VERIFY_FAILURES: Record<string, string> = { INVALID_OTP: "wrong_code", OTP_EXPIRED: "expired", OTP_NOT_FOUND: "no_code", TOO_MANY_ATTEMPTS: "locked" };
const verifyFailure = (e: unknown) => VERIFY_FAILURES[(e as { body?: { code?: string } }).body?.code ?? ""] ?? "error";

/**
 * Sends a code if the number is eligible. The answer never says whether a code went out (poultry-auth §0.9):
 * an invalid number, a per-number or a global block all look like success. Only an IP/subnet flood gets 429.
 * Order: IP/subnet limits, then the captcha, then the number, prefix and SMS-cost limits. So a request without a
 * solved captcha never spends a farmer's per-number budget or the global SMS cap.
 */
export async function requestCode(
  rawPhone: string,
  client: Client,
  captcha?: unknown,
): Promise<"sent_if_eligible" | "TOO_MANY_REQUESTS" | "CAPTCHA_REQUIRED"> {
  const phone = PhoneNumber.create(rawPhone);
  const event = eventFor(client, phone);
  const flood = await consume("requestCode", { ip: client.ip, subnet: client.subnet });
  if (flood.length > 0) {
    await event("rate_limited", blockedOn("requestCode", flood));
    return "TOO_MANY_REQUESTS";
  }
  if (!(await verifyCaptcha(captcha))) {
    await event("captcha_failed", "requestCode");
    return "CAPTCHA_REQUIRED";
  }

  if (!phone.ok) {
    await event("code_requested", "invalid_phone");
    return "sent_if_eligible";
  }
  const blocked = await consume("requestCode", { phone: phone.value.e164, prefix: phone.value.e164.slice(0, 7), global: "sms" });
  if (blocked.length === 0) await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone.value.e164 } });
  await (blocked.length === 0 ? event("code_requested", "eligible") : event("rate_limited", blockedOn("requestCode", blocked)));
  return "sent_if_eligible";
}

/**
 * Checks the code and opens a session. Every failure is the same INVALID_OR_EXPIRED_CODE.
 * After 3 consecutive failures for the number or the IP (rate-limiting.md §4) a solved captcha is required, checked
 * before the number's budget: so wrong codes alone can't use up a farmer's 10 tries an hour. The account never locks.
 * `request`: the login request's headers, for the organisation the browser last chose (SPEC-m5 PA6, a partner's sign-in).
 */
export async function verifyCode(
  rawPhone: string,
  code: string,
  locale: "ar" | "fr",
  client: Client,
  captcha?: unknown,
  request: Headers = new Headers(),
): Promise<Result<Headers, LoginError>> {
  const phone = PhoneNumber.create(rawPhone);
  const event = eventFor(client, phone);
  const flood = await consume("verifyCode", { ip: client.ip, subnet: client.subnet });
  if (flood.length > 0) {
    await event("rate_limited", blockedOn("verifyCode", flood));
    return fail("TOO_MANY_REQUESTS");
  }
  const who = { ip: client.ip, phone: phone.ok ? phone.value.e164 : undefined };
  // Counted as a failure before the code is checked, so parallel wrong codes can't all slip in under the threshold.
  // A refused captcha keeps that failure (captcha.md §5).
  if ((await consume("verifyFailures", who)).length > 0 && !(await verifyCaptcha(captcha))) {
    await event("captcha_failed", "verifyCode");
    return fail("CAPTCHA_REQUIRED");
  }
  if (!phone.ok) {
    await event("verify_failed", "invalid_phone");
    return fail("INVALID_OR_EXPIRED_CODE");
  }
  const budget = await consume("verifyCode", { phone: phone.value.e164 });
  if (budget.length > 0) {
    await event("rate_limited", blockedOn("verifyCode", budget));
    return fail("TOO_MANY_REQUESTS");
  }
  if (!/^\d{6}$/.test(code)) {
    await event("verify_failed", "malformed_code");
    return fail("INVALID_OR_EXPIRED_CODE");
  }

  try {
    const { headers, response } = await auth.api.verifyPhoneNumber({
      body: { phoneNumber: phone.value.e164, code },
      returnHeaders: true,
    });
    await reset("verifyFailures", who);
    // SPEC I3: the language used to log in is the user's current choice. (Better Auth drops extra body fields.)
    await db.user.update({ where: { id: response.user.id }, data: { locale } });
    await acceptInvitations(response.user.id, phone.value.e164);
    await recordAuthEvent("login", client, { userId: response.user.id, phone: phone.value.masked });
    await auditPartnerSignIn(response.user.id, request);
    return ok(headers);
  } catch (e) {
    await event("verify_failed", verifyFailure(e));
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
  const session = await getSession(headers);
  const out = await signOut(headers);
  if (session) await recordLogout(headers, session);
  return out;
}

async function signOut(headers: Headers): Promise<Headers> {
  try {
    const { headers: out } = await auth.api.signOut({ headers, returnHeaders: true });
    return out;
  } catch {
    return new Headers(); // no session to end: logging out is already done
  }
}

const recordLogout = (headers: Headers, session: { userId: string; phone?: string | null }, reason?: string) => {
  const phone = PhoneNumber.create(session.phone ?? "");
  return recordAuthEvent("logout", clientOf(headers), { userId: session.userId, phone: phone.ok ? phone.value.masked : undefined, reason });
};

/** poultry-auth §3, T25 S2: "log out all my devices" for a lost phone. Every session of this user ends, this one too. */
export async function logoutEverywhere(headers: Headers): Promise<Headers> {
  const session = await getSession(headers);
  const out = await signOut(headers);
  if (!session) return out;
  await recordLogout(headers, session, "everywhere");
  await db.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({ where: { userId: session.userId } });
    const memberships = await tx.membership.findMany({ where: { userId: session.userId }, select: { organizationId: true } });
    for (const { organizationId } of memberships)
      await tx.auditEvent.create({
        data: { organizationId, userId: session.userId, entity: "Session", entityId: session.userId, action: "revoke", after: { everywhere: true, otherDevices: count } },
      });
  });
  return out;
}
