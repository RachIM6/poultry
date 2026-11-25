import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCodeRoute } from "@/app/api/auth/request-code/route";
import { POST as resetRoute } from "@/app/api/auth/reset-password/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";
import { POST as verifyCodeRoute } from "@/app/api/auth/verify-code/route";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { createCaptchaChallenge } from "@/lib/security/captcha";
import type { TenantContext } from "@/lib/tenant";
import {
  acceptInvitation,
  getSession,
  getTenantContext,
  inviteMember,
  issueReset,
  issueResetFor,
  listMembers,
  myOrganizations,
  redeemInvite,
} from "@/modules/identity";
import { tenant, twoTenants } from "@/test/tenant";

// ADR-015: password login (phone or email), one-time invite and reset codes, SMS login off by a setting.
// Real requests to the route handlers, with the captcha disabled (vitest.config.ts) unless a test turns it on.

const ORIGIN = "http://localhost:3000";
const PASSWORD = "bab el had 2026";

beforeEach(() => vi.stubEnv("APP_ORIGIN", ORIGIN));
afterEach(() => vi.unstubAllEnvs());

const post = (route: (req: Request) => Promise<Response>, path: string, body: unknown, ip?: string) =>
  route(
    new Request(`${ORIGIN}/api/auth/${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, "x-requested-with": "poultry", "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
      body: JSON.stringify(body),
    }),
  );
const answer = async (res: Response) => ({ status: res.status, ...((await res.json()) as object) });
const cookieOf = (res: Response) => new Headers({ cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });

const signUp = (body: Record<string, unknown>, ip?: string) => post(signUpRoute, "sign-up", { password: PASSWORD, locale: "fr", ...body }, ip);
const signIn = (identifier: string, password = PASSWORD, extra: Record<string, unknown> = {}, ip?: string) =>
  post(signInRoute, "sign-in", { identifier, password, locale: "fr", ...extra }, ip);
const reset = (identifier: string, code: unknown, password = "a new long phrase", extra: Record<string, unknown> = {}) =>
  post(resetRoute, "reset-password", { identifier, code, password, locale: "ar", ...extra });
const events = (action: string) => db.authEvent.findMany({ where: { action }, orderBy: { id: "asc" } });
const INVALID = { status: 401, ok: false, messageKey: "errors.INVALID_CREDENTIALS" };

async function solved() {
  const challenge = await createCaptchaChallenge();
  return { challenge, solution: (await solveChallenge({ challenge, deriveKey }))! };
}
const withCaptcha = () => {
  vi.stubEnv("CAPTCHA_DISABLED", "");
  vi.stubEnv("CAPTCHA_HMAC_KEY", "test-only-captcha-key");
  vi.stubEnv("CAPTCHA_MAX_NUMBER", "3");
};

describe("sign-up and sign-in", () => {
  it("signs up with a phone and with an email, and signs in with either, with a Secure HttpOnly SameSite=Lax cookie", async () => {
    const byPhone = await signUp({ phone: "06 41 00 00 01" });
    expect(await answer(byPhone)).toEqual({ status: 201, ok: true, joined: false });
    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212641000001" }, include: { accounts: true } });
    expect(user).toMatchObject({ email: "212641000001@phone.invalid", phoneNumberVerified: false, locale: "fr" });
    expect(user.accounts).toMatchObject([{ providerId: "credential", accountId: user.id }]);
    expect(user.accounts[0].password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/); // Better Auth's scrypt: salt:key, never the password
    expect(await getTenantContext(cookieOf(byPhone))).toEqual({ ok: false, error: "NO_MEMBERSHIP" }); // an owner onboards next

    expect((await signUp({ email: "Karim.B@Example.MA" })).status).toBe(201);
    expect(await db.user.findUniqueOrThrow({ where: { email: "karim.b@example.ma" } })).toMatchObject({ phoneNumber: null });

    for (const identifier of ["0641000001", "+212641000001", "00212 641 000 001"]) {
      const res = await signIn(identifier);
      expect(res.status, identifier).toBe(200);
      const sid = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-sid="))!;
      for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=Lax/i, /Path=\//i]) expect(sid).toMatch(flag);
      expect(await getSession(cookieOf(res))).toMatchObject({ userId: user.id, phone: "+212641000001", phoneVerified: false });
    }
    expect((await signIn("KARIM.b@example.ma")).status).toBe(200);
    expect(await events("login")).toHaveLength(6); // 2 sign-ups, 4 sign-ins
  });

  it("refuses a taken phone or email, a bad identifier and a weak password, without creating anyone", async () => {
    const before = await db.user.count();
    expect(await answer(await signUp({ phone: "0641000001" }))).toEqual({ status: 409, ok: false, messageKey: "errors.ACCOUNT_EXISTS" });
    expect(await answer(await signUp({ phone: "0641000099", email: "karim.b@example.ma" }))).toMatchObject({ status: 409 }); // email taken
    expect(await answer(await signUp({}))).toMatchObject({ status: 400, messageKey: "errors.IDENTIFIER_REQUIRED" });
    expect(await answer(await signUp({ phone: "+33612345678" }))).toMatchObject({ status: 400, messageKey: "errors.INVALID_PHONE" });
    expect(await answer(await signUp({ email: "212641000002@phone.invalid" }))).toMatchObject({ status: 400, messageKey: "errors.INVALID_EMAIL" });
    expect(await answer(await signUp({ phone: "0641000002", password: "short" }))).toMatchObject({ status: 400, messageKey: "errors.PASSWORD_TOO_SHORT" });
    expect(await answer(await signUp({ phone: "0641000002", password: "0641000002" }))).toMatchObject({ status: 400, messageKey: "errors.WEAK_PASSWORD" });
    expect(await db.user.count()).toBe(before);
  });

  it("a wrong password and an unknown account get the same answer, and each an auth event", async () => {
    const wrong = await answer(await signIn("0641000001", "not the password"));
    const unknown = await answer(await signIn("0641999999"));
    const malformed = await answer(await signIn("not-an-identifier"));
    expect(wrong).toEqual(INVALID);
    expect(unknown).toEqual(INVALID);
    expect(malformed).toEqual(INVALID);
    expect((await events("sign_in_failed")).map((e) => [e.reason, e.phone])).toEqual([
      ["wrong_password", "+2126•••••01"],
      ["unknown_account", "+2126•••••99"],
      ["invalid_identifier", null],
    ]);
    const stored = JSON.stringify(await db.authEvent.findMany());
    for (const secret of [PASSWORD, "not the password", "641000001"]) expect(stored).not.toContain(secret);
  });

  it("an unknown account takes about as long as a wrong password (the password is hashed either way)", async () => {
    const time = async (identifier: string) => {
      const start = performance.now();
      await signIn(identifier, "not the password");
      return performance.now() - start;
    };
    await time("0641000001"); // warm-up
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 3; i++) {
      known.push(await time("0641000001"));
      unknown.push(await time(`06419999${10 + i}`));
    }
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[1];
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5); // without the hash, it would be a few ms
  });
});

describe("abuse limits (rate-limiting.md §3–4)", () => {
  beforeAll(() => db.rateLimitHit.deleteMany());

  it("from the 3rd failure a captcha is required, checked before the identifier's budget; a success resets the count", async () => {
    withCaptcha();
    for (let i = 0; i < 3; i++) expect(await answer(await signIn("0641000001", "wrong password"))).toEqual(INVALID);
    const budget = () => db.rateLimitHit.count({ where: { key: { startsWith: "signIn:account:3600:" } } });
    const spent = await budget();
    expect(await answer(await signIn("0641000001"))).toMatchObject({ status: 400, messageKey: "errors.CAPTCHA_REQUIRED" });
    expect(await budget()).toBe(spent); // refused before the budget: guesses without a captcha can't lock the farmer out
    expect((await events("captcha_failed")).at(-1)).toMatchObject({ reason: "signIn", phone: "+2126•••••01" });

    expect((await signIn("0641000001", PASSWORD, { captcha: await solved() })).status).toBe(200);
    expect((await signIn("0641000001", "wrong password")).status).toBe(401); // back to normal: no captcha needed
    expect((await signIn("0641000001")).status).toBe(200);
  });

  it("an identifier's budget (10 / h) then refuses, without locking any other account", async () => {
    await db.rateLimitHit.deleteMany();
    await signUp({ phone: "0641000010" });
    for (let i = 0; i < 9; i++) await db.rateLimitHit.create({ data: { key: (await keyOf("signIn:account:3600:", "+212641000010"))! } });
    expect((await signIn("0641000010")).status).toBe(200); // the 10th
    const blocked = await signIn("0641000010");
    expect(await answer(blocked)).toEqual({ status: 429, ok: false, messageKey: "errors.TOO_MANY_REQUESTS" });
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect((await signIn("0641000001")).status).toBe(200);
    expect((await events("rate_limited")).at(-1)).toMatchObject({ reason: "signIn:account", phone: "+2126•••••10" });
  });

  it("per IP once a proxy is trusted (30 / 15 min), and a forged X-Forwarded-For without one counts nothing", async () => {
    await db.rateLimitHit.deleteMany();
    expect((await signIn("0641000001", PASSWORD, {}, "105.66.9.9")).status).toBe(200);
    expect(await db.rateLimitHit.count({ where: { key: { contains: ":ip:" } } })).toBe(0); // no trusted proxy: no IP

    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    await db.rateLimitHit.createMany({ data: Array.from({ length: 30 }, () => ({ key: "signIn:ip:900:105.66.9.9" })) });
    expect(await answer(await signIn("0641000001", PASSWORD, {}, "105.66.9.9"))).toEqual({ status: 429, ok: false, messageKey: "errors.TOO_MANY_REQUESTS" });
    expect((await signIn("0641000001", PASSWORD, {}, "105.66.8.8")).status).toBe(200);
    expect((await events("rate_limited")).at(-1)).toMatchObject({ reason: "signIn:ip", ip: "105.66.9.0/24" });
  });

  it("sign-up needs a solved captcha every time", async () => {
    withCaptcha();
    expect(await answer(await signUp({ phone: "0641000020" }))).toMatchObject({ status: 400, messageKey: "errors.CAPTCHA_REQUIRED" });
    expect((await signUp({ phone: "0641000020", captcha: await solved() })).status).toBe(201);
  });
});

// The key of one account dimension, as rate-limit.ts writes it (the identifier hashed).
async function keyOf(prefix: string, value: string) {
  const { createHash } = await import("node:crypto");
  return `${prefix}${createHash("sha256").update(value).digest("base64url")}`;
}

describe("invite codes (ADR-015)", () => {
  let a: TenantContext, b: TenantContext;
  beforeAll(async () => {
    await db.rateLimitHit.deleteMany();
    [a, b] = await twoTenants();
  });

  const invite = async (ctx: TenantContext, phone: string, role = "worker", accessUntil?: string) => {
    const res = await inviteMember(ctx, { phone, role, accessUntil });
    if (!res.ok) throw new Error(res.error);
    expect(res.value.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    return res.value.code;
  };

  it("is stored only as a hash, joins its organisation with its role at sign-up, once", async () => {
    const code = await invite(a, "0643000001");
    const row = await db.invitation.findFirstOrThrow({ where: { phoneNumber: "+212643000001" } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code.replace("-", ""));
    expect((await events("invite_issued")).at(-1)).toMatchObject({ userId: a.userId, reason: "worker", phone: "+2126•••••01" });

    const res = await signUp({ phone: "0643000001", inviteCode: code.toLowerCase().replace("-", " ") }); // typed loosely
    expect(await answer(res)).toEqual({ status: 201, ok: true, joined: true });
    expect(await getTenantContext(cookieOf(res))).toMatchObject({ ok: true, value: { organizationId: a.organizationId, role: "worker" } });
    expect(await db.invitation.count({ where: { id: row.id } })).toBe(0);
    expect((await events("invite_accepted")).at(-1)).toMatchObject({ reason: "sign_up" });

    // Single use: the same code again creates nobody.
    expect(await answer(await signUp({ phone: "0643000002", inviteCode: code }))).toMatchObject({ status: 400, messageKey: "errors.INVALID_INVITE_CODE" });
    expect(await db.user.count({ where: { phoneNumber: "+212643000002" } })).toBe(0);
  });

  it("an invited number signing up without the code gets no access to the inviting organisation", async () => {
    await invite(a, "0643000003", "manager");
    const res = await signUp({ phone: "0643000003" });
    expect(res.status).toBe(201);
    const headers = cookieOf(res);
    expect(await getTenantContext(headers)).toEqual({ ok: false, error: "NO_MEMBERSHIP" }); // onboards as a new owner
    expect(await myOrganizations(headers)).toMatchObject({ ok: true, value: { memberships: [], invitations: [] } }); // the phone isn't verified
    const pending = await db.invitation.findFirstOrThrow({ where: { phoneNumber: "+212643000003" } });
    expect(await acceptInvitation(headers, pending.id)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(await signIn("0643000003").then((r) => getTenantContext(cookieOf(r)))).toEqual({ ok: false, error: "NO_MEMBERSHIP" });
    expect(await db.membership.count({ where: { organizationId: a.organizationId, user: { phoneNumber: "+212643000003" } } })).toBe(0);
  });

  it("opens only its own organisation, expires after 7 days, and dies when re-issued or cancelled", async () => {
    const codeB = await invite(b, "0643000004");
    const signedIn = cookieOf(await signUp({ phone: "0643000004" }));
    expect(await redeemInvite(signedIn, codeB)).toEqual({ ok: true, value: b.organizationId });
    const membersOfA = await listMembers(a);
    expect(membersOfA.ok && membersOfA.value.members.map((m) => m.phone)).not.toContain("+212643000004");
    expect(await getTenantContext(signedIn)).toMatchObject({ ok: true, value: { organizationId: b.organizationId } });

    const old = await invite(a, "0643000005");
    const fresh = await invite(a, "0643000005"); // invited again: a new code, the old one is dead
    const other = cookieOf(await signUp({ phone: "0643000005" }));
    expect(await redeemInvite(other, old)).toEqual({ ok: false, error: "INVALID_INVITE_CODE" });
    const sevenDaysOn = fixedClock(new Date(Date.now() + 7 * 86_400_000 + 1_000).toISOString());
    expect(await redeemInvite(other, fresh, sevenDaysOn)).toEqual({ ok: false, error: "INVALID_INVITE_CODE" });
    await db.invitation.deleteMany({ where: { phoneNumber: "+212643000005" } }); // cancelled
    expect(await redeemInvite(other, fresh)).toEqual({ ok: false, error: "INVALID_INVITE_CODE" });
    expect(await getTenantContext(other)).toEqual({ ok: false, error: "NO_MEMBERSHIP" });
    expect((await events("invite_failed")).length).toBeGreaterThanOrEqual(3);
  });

  it("a left organisation takes no one new: its codes are refused (docs/data-requests.md)", async () => {
    const left = await tenant("+212600000013", "Ferme Partie");
    const code = await invite(left, "0643000008");
    await db.organization.update({ where: { id: left.organizationId }, data: { leftAt: new Date() } });
    expect(await answer(await signUp({ phone: "0643000008", inviteCode: code }))).toMatchObject({ status: 400, messageKey: "errors.INVALID_INVITE_CODE" });
    const signedIn = cookieOf(await signUp({ phone: "0643000008" }));
    expect(await redeemInvite(signedIn, code)).toEqual({ ok: false, error: "INVALID_INVITE_CODE" });
  });

  it("a partner joins with a code: role and end day from the invitation", async () => {
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const code = await invite(a, "0643000006", "vet", until);
    const res = await signUp({ email: "vet@example.ma", inviteCode: code }); // a partner may use an email only
    expect(res.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { email: "vet@example.ma" } });
    const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership).toMatchObject({ organizationId: a.organizationId, role: "vet" });
    expect(membership.accessUntil?.toISOString().slice(0, 10)).toBe(until);
    const members = await listMembers(a);
    expect(members.ok && members.value.members.find((m) => m.userId === user.id)).toMatchObject({ phone: null, email: "vet@example.ma" });
  });

  it("attempts are limited per signed-in user (10 / h) and per IP at sign-up", async () => {
    await db.rateLimitHit.deleteMany();
    const someone = cookieOf(await signUp({ phone: "0643000007" }));
    for (let i = 0; i < 10; i++) expect(await redeemInvite(someone, "AAAA-AAAA")).toEqual({ ok: false, error: "INVALID_INVITE_CODE" });
    const code = await invite(a, "0643000007");
    expect(await redeemInvite(someone, code)).toEqual({ ok: false, error: "TOO_MANY_REQUESTS" }); // even the right one, for now

    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (let i = 0; i < 20; i++) await signUp({ phone: `064400${String(i).padStart(4, "0")}`, inviteCode: "BBBB-BBBB" }, "105.66.3.3");
    expect(await answer(await signUp({ phone: "0644009999", inviteCode: code }, "105.66.3.3"))).toMatchObject({ status: 429 });
    expect(await db.user.count({ where: { phoneNumber: { startsWith: "+2126440" } } })).toBe(0);
  });
});

describe("password reset (ADR-015)", () => {
  let a: TenantContext, workerMembership: string;
  beforeAll(async () => {
    await db.rateLimitHit.deleteMany();
    a = await tenant("+212600000010", "Ferme Reset");
    const invited = await inviteMember(a, { phone: "0645000001", role: "worker" });
    if (!invited.ok) throw new Error(invited.error);
    await signUp({ phone: "0645000001", inviteCode: invited.value.code });
    workerMembership = (await db.membership.findFirstOrThrow({ where: { organizationId: a.organizationId, role: "worker" } })).id;
  });

  it("the owner's code sets a new password once, ends every session, and opens one here", async () => {
    const devices = [cookieOf(await signIn("0645000001")), cookieOf(await signIn("0645000001"))];
    const issued = await issueReset(a, { membershipId: workerMembership });
    if (!issued.ok) throw new Error(issued.error);
    expect(await db.passwordReset.findFirstOrThrow({})).toMatchObject({ issuedById: a.userId, codeHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    for (const d of devices) expect(await getSession(d)).not.toBeNull(); // issuing alone logs nobody out

    expect(await answer(await reset("0645000001", issued.value.code, "short"))).toMatchObject({ status: 400, messageKey: "errors.PASSWORD_TOO_SHORT" });
    const res = await reset("0645000001", issued.value.code);
    expect(res.status).toBe(200);
    for (const d of devices) expect(await getSession(d)).toBeNull();
    expect(await getSession(cookieOf(res))).toMatchObject({ phone: "+212645000001" });
    expect(await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212645000001" } })).toMatchObject({ locale: "ar" });
    expect(await answer(await signIn("0645000001"))).toEqual(INVALID); // the old password
    expect((await signIn("0645000001", "a new long phrase")).status).toBe(200);

    const again = await answer(await reset("0645000001", issued.value.code, "another long phrase"));
    expect(again).toEqual({ status: 401, ok: false, messageKey: "errors.INVALID_RESET_CODE" }); // single use
    expect((await events("reset_used")).length).toBe(1);
    expect((await events("reset_issued")).at(-1)).toMatchObject({ reason: "owner" });
  });

  it("every refusal is the same INVALID_RESET_CODE: unknown account, wrong, malformed or expired code", async () => {
    const issued = await issueReset(a, { membershipId: workerMembership });
    if (!issued.ok) throw new Error(issued.error);
    const refused = { status: 401, ok: false, messageKey: "errors.INVALID_RESET_CODE" };
    expect(await answer(await reset("0645999999", issued.value.code))).toEqual(refused);
    expect(await answer(await reset("0645000001", "ZZZZ-ZZZZ"))).toEqual(refused);
    expect(await answer(await reset("0645000001", "nope"))).toEqual(refused);
    await db.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await answer(await reset("0645000001", issued.value.code))).toEqual(refused);
    expect((await events("reset_failed")).slice(-4).map((e) => e.reason)).toEqual(["unknown_account", "wrong_code", "malformed_code", "wrong_code"]);
  });

  it("an owner can't reset another owner, themselves, or a member who belongs to another farm", async () => {
    expect(await issueReset(a, { membershipId: (await db.membership.findFirstOrThrow({ where: { organizationId: a.organizationId, role: "owner" } })).id })).toEqual({
      ok: false,
      error: "RESET_NOT_ALLOWED",
    });
    const b = await tenant("+212600000011", "Ferme Voisine");
    const code = await inviteMember(b, { phone: "0645000001", role: "vet" });
    if (!code.ok) throw new Error(code.error);
    const worker = cookieOf(await signIn("0645000001", "a new long phrase"));
    expect((await redeemInvite(worker, code.value.code)).ok).toBe(true);
    expect(await issueReset(a, { membershipId: workerMembership })).toEqual({ ok: false, error: "RESET_NOT_ALLOWED" });
    expect(await issueReset(b, { membershipId: workerMembership })).toEqual({ ok: false, error: "NOT_FOUND" }); // not b's membership
    expect(await issueReset({ ...a, role: "manager" }, { membershipId: workerMembership })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("the operator's reset (pnpm user:reset) works for anyone, owners included, and is audited", async () => {
    expect(await issueResetFor("nobody")).toEqual({ ok: false, error: "INVALID_IDENTIFIER" });
    expect(await issueResetFor("0645999999")).toEqual({ ok: false, error: "NOT_FOUND" });
    const owner = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    await db.account.create({ data: { userId: owner.id, providerId: "credential", accountId: owner.id, password: "x:y" } });
    const issued = await issueResetFor("0600000010");
    if (!issued.ok) throw new Error(issued.error);
    expect(await db.passwordReset.findFirstOrThrow({ where: { userId: owner.id } })).toMatchObject({ issuedById: null });
    expect((await events("reset_issued")).at(-1)).toMatchObject({ userId: owner.id, reason: "operator", phone: "+2126•••••10" });
    expect((await reset("+212600000010", issued.value.code, "owner long phrase")).status).toBe(200);
    expect((await signIn("0600000010", "owner long phrase")).status).toBe(200);
  });
});

describe("SMS code login is off unless AUTH_SMS_ENABLED=true", () => {
  it("off: both code endpoints answer 404 and send nothing", async () => {
    for (const [route, path] of [[requestCodeRoute, "request-code"], [verifyCodeRoute, "verify-code"]] as const) {
      const res = await post(route, path, { phone: "0646000001", code: "123456" });
      expect(res.status).toBe(404);
    }
    expect(await db.verification.count()).toBe(0);
  });

  it("on: today's flow works, and a verified phone still joins its invitations without a code", async () => {
    vi.stubEnv("AUTH_SMS_ENABLED", "true");
    const c = await tenant("+212600000012", "Ferme SMS");
    await inviteMember(c, { phone: "0646000002", role: "worker" });
    expect((await post(requestCodeRoute, "request-code", { phone: "0646000002" })).status).toBe(202);
    const code = (await db.verification.findFirstOrThrow({ where: { identifier: "phone-number-otp-+212646000002" } })).value.split(":")[0];
    const res = await post(verifyCodeRoute, "verify-code", { phone: "0646000002", code, locale: "fr" });
    expect(res.status).toBe(200);
    expect(await getSession(cookieOf(res))).toMatchObject({ phoneVerified: true });
    expect(await getTenantContext(cookieOf(res))).toMatchObject({ ok: true, value: { organizationId: c.organizationId, role: "worker" } });
  });
});
