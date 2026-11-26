import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { verifyCaptcha } from "@/lib/security/captcha";
import type { PolicyName } from "@/lib/security/policies";
import { consume, reset } from "@/lib/security/rate-limit";
import { checkPassword, maskIdentifier, parseEmail, parseIdentifier, type Identifier } from "@/modules/identity/domain/identifier";
import { PhoneNumber } from "@/modules/identity/domain/phone-number";
import { clientOf } from "@/modules/identity/application/login";
import { claimInvitation, saveResetCode, type ForgetDevices } from "@/modules/identity/application/members";
import { auditPartnerSignIn } from "@/modules/identity/application/membership";
import { getSession } from "@/modules/identity/application/session";
import { recordAuthEvent, type AuthAction, type Client } from "@/modules/identity/infrastructure/auth-events";
import { auth, phoneEmail } from "@/modules/identity/infrastructure/better-auth";
import { codeHash, normalizeCode } from "@/modules/identity/infrastructure/codes";
import { Names } from "@/modules/identity/schema";

// ADR-015: password login with the phone or the email, one-time invite and reset codes. Better Auth hashes (scrypt)
// and opens sessions; the rate limits, captcha, uniform answers and auth events are ours, as for the code login.

type Locale = "ar" | "fr";
type Gate = "TOO_MANY_REQUESTS" | "CAPTCHA_REQUIRED";
type PasswordError = "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "WEAK_PASSWORD";

// Better Auth looks this up, finds nobody and still hashes the password: an unknown account costs the same time.
const NO_ACCOUNT = "no-account@account.invalid";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const accountKey = (id: Identifier) => (id.kind === "phone" ? id.phone.e164 : id.email);
const userOf = (id: Identifier) =>
  id.kind === "phone" ? db.user.findUnique({ where: { phoneNumber: id.phone.e164 } }) : db.user.findUnique({ where: { email: id.email } });
const blockedOn = (policy: PolicyName, dims: string[]) => `${policy}:${dims.join(",")}`;
const eventFor = (client: Client, masked?: string) => (action: AuthAction, reason: string, userId?: string) =>
  recordAuthEvent(action, client, { reason, userId, phone: masked });

/**
 * rate-limiting.md §3–4 in front of a password or reset-code check: IP and subnet first (floods stop before any
 * hashing); from the 3rd consecutive failure for the identifier or the IP a solved, unused captcha, checked before the
 * identifier's budget so wrong guesses alone can't use up a farmer's tries; then that budget and the global breaker.
 * Every failure counts until a success resets it. The account itself never locks.
 */
async function gate(policy: "signIn" | "resetPassword", client: Client, account: string | undefined, captcha: unknown, event: ReturnType<typeof eventFor>): Promise<Gate | null> {
  const flood = await consume(policy, { ip: client.ip, subnet: client.subnet });
  if (flood.length > 0) {
    await event("rate_limited", blockedOn(policy, flood));
    return "TOO_MANY_REQUESTS";
  }
  if ((await consume("signInFailures", { ip: client.ip, account })).length > 0 && !(await verifyCaptcha(captcha))) {
    await event("captcha_failed", policy);
    return "CAPTCHA_REQUIRED";
  }
  const budget = await consume(policy, { account, global: "all" });
  if (budget.length > 0) {
    await event("rate_limited", blockedOn(policy, budget));
    return "TOO_MANY_REQUESTS";
  }
  return null;
}

/** Better Auth checks the password and opens the session; the headers carry its Set-Cookie. Null on any refusal. */
async function openSession(email: string, password: string) {
  try {
    return await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  } catch {
    return null;
  }
}

/** After a success: forgets the failures, saves the language used (SPEC I3), audits the login. */
async function signedIn(userId: string, locale: Locale, client: Client, account: string, masked: string, reason: string) {
  await reset("signInFailures", { ip: client.ip, account });
  await db.user.update({ where: { id: userId }, data: { locale } });
  await recordAuthEvent("login", client, { userId, phone: masked, reason });
}

/**
 * Sign-in with the phone or the email and the password. Every refusal is the same INVALID_CREDENTIALS: unknown account,
 * wrong password, an account with no password, a malformed identifier (poultry-auth §0.9).
 * `request`: the request's headers, for the organisation a partner last chose (SPEC-m5 PA6).
 */
export async function signIn(
  rawIdentifier: string,
  password: string,
  locale: Locale,
  client: Client,
  captcha?: unknown,
  request: Headers = new Headers(),
): Promise<Result<Headers, "INVALID_CREDENTIALS" | Gate>> {
  const id = parseIdentifier(rawIdentifier);
  const event = eventFor(client, id.ok ? maskIdentifier(id.value) : undefined);
  const gated = await gate("signIn", client, id.ok ? accountKey(id.value) : undefined, captcha, event);
  if (gated) return fail(gated);
  if (!id.ok) {
    await event("sign_in_failed", "invalid_identifier");
    return fail("INVALID_CREDENTIALS");
  }

  const user = await userOf(id.value);
  const session = await openSession(user?.email ?? NO_ACCOUNT, password);
  if (!session) {
    await event("sign_in_failed", user ? "wrong_password" : "unknown_account", user?.id);
    return fail("INVALID_CREDENTIALS");
  }
  await signedIn(session.response.user.id, locale, client, accountKey(id.value), maskIdentifier(id.value), "password");
  await auditPartnerSignIn(session.response.user.id, request);
  return ok(session.headers);
}

type SignUpError = Gate | PasswordError | "INVALID_NAME" | "IDENTIFIER_REQUIRED" | "INVALID_PHONE" | "INVALID_EMAIL" | "ACCOUNT_EXISTS" | "INVALID_INVITE_CODE";
class InviteRefused extends Error {}

/**
 * A new account with a phone and/or an email, and a password; it opens a session. Without an invite code the person
 * onboards a new organisation (an owner). With one, they join the invitation's organisation with its role, in the
 * same transaction: a refused code creates no account. Everyone gives a first and a last name. Captcha always. Says when the phone or email is taken
 * (ACCOUNT_EXISTS): without SMS or email nothing else can tell the real owner (ADR-015, accepted).
 */
export async function signUp(
  input: { firstName?: unknown; lastName?: unknown; phone?: string; email?: string; password: string; inviteCode?: string },
  locale: Locale,
  client: Client,
  captcha?: unknown,
  clock: Clock = systemClock,
): Promise<Result<{ headers: Headers; joined: boolean }, SignUpError>> {
  const flood = await consume("signUp", { ip: client.ip, subnet: client.subnet });
  if (flood.length > 0) {
    await recordAuthEvent("rate_limited", client, { reason: blockedOn("signUp", flood) });
    return fail("TOO_MANY_REQUESTS");
  }
  if (!(await verifyCaptcha(captcha))) {
    await recordAuthEvent("captcha_failed", client, { reason: "signUp" });
    return fail("CAPTCHA_REQUIRED");
  }
  const global = await consume("signUp", { global: "all" }); // after the captcha: a bot without one can't spend it
  if (global.length > 0) {
    await recordAuthEvent("rate_limited", client, { reason: blockedOn("signUp", global) });
    return fail("TOO_MANY_REQUESTS");
  }

  const names = Names.safeParse({ firstName: input.firstName, lastName: input.lastName });
  if (!names.success) return fail("INVALID_NAME");
  const phone = input.phone?.trim() ? PhoneNumber.create(input.phone) : null;
  if (phone && !phone.ok) return phone;
  const email = input.email?.trim() ? parseEmail(input.email) : null;
  if (email && !email.ok) return email;
  if (!phone && !email) return fail("IDENTIFIER_REQUIRED");
  const password = checkPassword(input.password, { phone: phone?.value, email: email?.value });
  if (!password.ok) return password;
  const id: Identifier = phone ? { kind: "phone", phone: phone.value } : { kind: "email", email: email!.value };
  const event = eventFor(client, maskIdentifier(id));

  const code = input.inviteCode?.trim() ? input.inviteCode : null;
  if (code !== null) {
    const blocked = await consume("inviteCode", { ip: client.ip, subnet: client.subnet, global: "all" });
    if (blocked.length > 0) {
      await event("rate_limited", blockedOn("inviteCode", blocked));
      return fail("TOO_MANY_REQUESTS");
    }
  }

  const loginEmail = email?.value ?? phoneEmail(phone!.value.e164);
  const hash = await (await auth.$context).password.hash(password.value);
  let user: { id: string };
  let joined: string | null = null;
  try {
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { phoneNumber: phone?.value.e164, email: loginEmail, ...names.data, locale } });
      await tx.account.create({ data: { userId: created.id, providerId: "credential", accountId: created.id, password: hash } });
      if (code !== null) {
        const claimed = await claimInvitation(tx, created.id, code, clock);
        if (!claimed.ok) throw new InviteRefused();
        joined = claimed.value.organizationId;
      }
      return created;
    });
  } catch (e) {
    if (e instanceof InviteRefused) {
      await event("invite_failed", "sign_up");
      return fail("INVALID_INVITE_CODE");
    }
    if ((e as { code?: string }).code !== "P2002") throw e; // the phone or the email is already an account's
    await event("sign_up", "account_exists");
    return fail("ACCOUNT_EXISTS");
  }

  await event("sign_up", joined ? "invite" : "owner", user.id);
  if (joined) await recordAuthEvent("invite_accepted", client, { userId: user.id, phone: maskIdentifier(id), reason: "sign_up" });
  const session = await openSession(loginEmail, password.value);
  if (!session) throw new Error("Sign-in right after sign-up failed.");
  await recordAuthEvent("login", client, { userId: user.id, phone: maskIdentifier(id), reason: "sign_up" });
  return ok({ headers: session.headers, joined: joined !== null });
}

/**
 * Sets a new password with a one-time reset code (issued by the owner or the operator), revokes every session of the
 * user, forgets their devices' pushes (`forgetDevices`: a lost phone stops showing them), and opens a session here.
 * Issuing a code changes nothing until it is used, so only its use forgets devices. Every refusal of the code is the
 * same INVALID_RESET_CODE: unknown account, wrong, expired or used code. Password rules are checked against the typed identifier first, so they say nothing about the account.
 */
export async function resetPassword(
  rawIdentifier: string,
  rawCode: unknown,
  newPassword: string,
  locale: Locale,
  client: Client,
  forgetDevices: ForgetDevices,
  captcha?: unknown,
  clock: Clock = systemClock,
): Promise<Result<Headers, Gate | PasswordError | "INVALID_RESET_CODE">> {
  const id = parseIdentifier(rawIdentifier);
  const event = eventFor(client, id.ok ? maskIdentifier(id.value) : undefined);
  const gated = await gate("resetPassword", client, id.ok ? accountKey(id.value) : undefined, captcha, event);
  if (gated) return fail(gated);
  if (!id.ok) {
    await event("reset_failed", "invalid_identifier");
    return fail("INVALID_RESET_CODE");
  }
  const password = checkPassword(newPassword, id.value.kind === "phone" ? { phone: id.value.phone } : { email: id.value.email });
  if (!password.ok) return password;

  const user = await userOf(id.value);
  const code = normalizeCode(rawCode);
  // An unknown account hashes and looks its code up too (under a nil id), so it answers in the same time as a wrong
  // code. The hash (scrypt) is computed before the transaction, which stays short.
  const hash = code !== null ? await (await auth.$context).password.hash(password.value) : null;
  const done =
    code !== null &&
    (await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "PasswordReset"
        WHERE "userId" = ${user?.id ?? NIL_UUID}::uuid AND "codeHash" = ${codeHash("reset", code)} AND "expiresAt" > ${clock.now()}
        FOR UPDATE`;
      if (!row || !user) return false;
      const credential = await tx.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
      if (credential) await tx.account.update({ where: { id: credential.id }, data: { password: hash! } });
      else await tx.account.create({ data: { userId: user.id, providerId: "credential", accountId: user.id, password: hash! } });
      await tx.session.deleteMany({ where: { userId: user.id } }); // every device signs in again with the new password
      await forgetDevices(tx, user.id);
      await tx.passwordReset.deleteMany({ where: { userId: user.id } });
      return true;
    }));
  if (!done || !user) {
    await event("reset_failed", !code ? "malformed_code" : !user ? "unknown_account" : "wrong_code", user?.id);
    return fail("INVALID_RESET_CODE");
  }

  await event("reset_used", "sessions_revoked", user.id);
  const session = await openSession(user.email, password.value);
  if (!session) throw new Error("Sign-in right after a password reset failed.");
  await signedIn(user.id, locale, client, accountKey(id.value), maskIdentifier(id.value), "reset");
  return ok(session.headers);
}

/**
 * Sets a user's password directly (the demo seed's DEMO_PHONE owner, DEMO_PASSWORD). Not for any request path: those
 * go through sign-up or a reset code. Returns the policy error rather than setting a weak password.
 */
export async function setPassword(userId: string, password: string): Promise<Result<void, PasswordError>> {
  const checked = checkPassword(password);
  if (!checked.ok) return checked;
  const hash = await (await auth.$context).password.hash(checked.value);
  const credential = await db.account.findFirst({ where: { userId, providerId: "credential" } });
  if (credential) await db.account.update({ where: { id: credential.id }, data: { password: hash } });
  else await db.account.create({ data: { userId, providerId: "credential", accountId: userId, password: hash } });
  return ok(undefined);
}

/** The operator's reset (`pnpm user:reset <phone|email>`): a code for anyone, owners included. Audited. */
export async function issueResetFor(rawIdentifier: string): Promise<Result<{ code: string }, "INVALID_IDENTIFIER" | "NOT_FOUND">> {
  const id = parseIdentifier(rawIdentifier);
  if (!id.ok) return id;
  const user = await userOf(id.value);
  if (!user) return fail("NOT_FOUND");
  const code = await saveResetCode(user.id, null);
  await recordAuthEvent("reset_issued", {}, { userId: user.id, phone: maskIdentifier(id.value), reason: "operator" });
  return ok({ code });
}

/**
 * A signed-in user joins an organisation with an invite code (onboarding, "Changer d'exploitation"). Returns the
 * organisation it opens. Attempts are counted per user and globally (inviteCode policy).
 */
export async function redeemInvite(headers: Headers, rawCode: unknown, clock: Clock = systemClock): Promise<Result<string, "UNAUTHENTICATED" | "INVALID_INVITE_CODE" | "TOO_MANY_REQUESTS">> {
  const session = await getSession(headers);
  if (!session) return fail("UNAUTHENTICATED");
  const client = clientOf(headers);
  const blocked = await consume("inviteCode", { user: session.userId, global: "all" });
  if (blocked.length > 0) {
    await recordAuthEvent("rate_limited", client, { userId: session.userId, reason: blockedOn("inviteCode", blocked) });
    return fail("TOO_MANY_REQUESTS");
  }
  const claimed = await db.$transaction((tx) => claimInvitation(tx, session.userId, rawCode, clock));
  await recordAuthEvent(claimed.ok ? "invite_accepted" : "invite_failed", client, { userId: session.userId, reason: "signed_in" });
  return claimed.ok ? ok(claimed.value.organizationId) : claimed;
}
