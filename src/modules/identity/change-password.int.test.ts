import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";
import { db } from "@/lib/db";
import { changePassword, getSession, hasPassword, type ForgetDevices } from "@/modules/identity";

// « Informations personnelles »: a signed-in user changes their own password. Real sign-up and sign-in requests make
// the sessions; the captcha is disabled (vitest.config.ts).

const ORIGIN = "http://localhost:3000";
const PASSWORD = "bab el had 2026";
const NEW = "a brand new phrase";

beforeEach(() => vi.stubEnv("APP_ORIGIN", ORIGIN));
afterEach(() => vi.unstubAllEnvs());

const post = (route: (req: Request) => Promise<Response>, path: string, body: unknown) =>
  route(
    new Request(`${ORIGIN}/api/auth/${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, "x-requested-with": "poultry", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const cookieOf = (res: Response, ip?: string) =>
  new Headers({ cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), ...(ip ? { "x-forwarded-for": ip } : {}) });
const signUp = async (phone: string) => cookieOf(await post(signUpRoute, "sign-up", { firstName: "Karim", lastName: "Ben Ahmed", phone, password: PASSWORD, locale: "fr" }));
const signIn = async (identifier: string, password = PASSWORD) => post(signInRoute, "sign-in", { identifier, password, locale: "fr" });
// What the app passes (notifications forgetPushSubscriptions; identity can't import it, CAPABILITY-MAP). e2e/login.spec.ts covers the real one.
const forgetPushes: ForgetDevices = (tx, userId) => tx.pushSubscription.deleteMany({ where: { userId } });
const change = (headers: Headers, current: string, next = NEW, confirm = next) => changePassword(headers, { current, next, confirm }, forgetPushes);
const events = (action: string) => db.authEvent.findMany({ where: { action }, orderBy: { id: "asc" } });
const hashOf = async (phone: string) =>
  (await db.account.findFirstOrThrow({ where: { providerId: "credential", user: { phoneNumber: phone } } })).password;

describe("changePassword", () => {
  beforeEach(() => db.rateLimitHit.deleteMany());

  it("keeps this session, ends every other one, forgets the pushes, and only the new password signs in; audited", async () => {
    const here = await signUp("0647000001");
    const others = [cookieOf(await signIn("0647000001")), cookieOf(await signIn("0647000001"))];
    const someoneElse = await signUp("0647000002");
    const [me, them] = [(await getSession(here))!.userId, (await getSession(someoneElse))!.userId];
    const pushes = (userId: string) => db.pushSubscription.count({ where: { userId } });
    for (const [userId, n] of [[me, 1], [me, 2], [them, 3]] as const)
      await db.pushSubscription.create({ data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/change-${n}`, p256dh: "k", auth: "a" } });

    expect(await change(here, PASSWORD)).toEqual({ ok: true, value: undefined });
    expect(await getSession(here)).toMatchObject({ phone: "+212647000001" });
    for (const other of others) expect(await getSession(other)).toBeNull();
    expect(await getSession(someoneElse)).not.toBeNull(); // nobody else's sessions
    expect(await pushes(me)).toBe(0); // a lost or shared phone stops showing this user's notifications (the page re-registers this one)
    expect(await pushes(them)).toBe(1); // someone else's stay
    expect((await signIn("0647000001")).status).toBe(401); // the old password
    expect((await signIn("0647000001", NEW)).status).toBe(200);

    expect((await events("password_changed")).at(-1)).toMatchObject({ reason: "other_sessions_ended:2", phone: "+2126•••••01" });
    const stored = JSON.stringify(await db.authEvent.findMany());
    for (const secret of [PASSWORD, NEW, "647000001"]) expect(stored).not.toContain(secret);
  });

  it("a wrong current password is one uniform error, audited, and changes nothing", async () => {
    const here = await signUp("0647000010");
    const before = await hashOf("+212647000010");
    const me = (await getSession(here))!.userId;
    await db.pushSubscription.create({ data: { userId: me, endpoint: "https://fcm.googleapis.com/fcm/send/change-kept", p256dh: "k", auth: "a" } });
    for (const current of ["not the password", "", "x".repeat(200)])
      expect(await change(here, current)).toEqual({ ok: false, error: "INVALID_CURRENT_PASSWORD" });
    expect(await hashOf("+212647000010")).toBe(before);
    expect(await db.pushSubscription.count({ where: { userId: me } })).toBe(1); // a refusal forgets no device
    expect((await events("password_change_failed")).map((e) => e.reason)).toEqual(["wrong_password", "wrong_password", "wrong_password"]);
    expect((await signIn("0647000010")).status).toBe(200);
  });

  it("the new password follows sign-up's rules and must match its confirmation, checked before any try is spent", async () => {
    const here = await signUp("0647000020");
    expect(await change(here, PASSWORD, "short")).toEqual({ ok: false, error: "PASSWORD_TOO_SHORT" });
    expect(await change(here, PASSWORD, "y".repeat(129))).toEqual({ ok: false, error: "PASSWORD_TOO_LONG" });
    expect(await change(here, PASSWORD, "azertyuiop")).toEqual({ ok: false, error: "WEAK_PASSWORD" });
    expect(await change(here, PASSWORD, "mon numéro 0647000020")).toEqual({ ok: false, error: "WEAK_PASSWORD" }); // their own phone
    expect(await change(here, PASSWORD, NEW, "a brand new phrasE")).toEqual({ ok: false, error: "PASSWORDS_DIFFER" });
    expect(await db.rateLimitHit.count({ where: { key: { startsWith: "changePassword:" } } })).toBe(0);
    expect((await signIn("0647000020")).status).toBe(200);
  });

  it("refuses without a session, and an account with no password has nothing to change", async () => {
    expect(await change(new Headers(), PASSWORD)).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    const here = await signUp("0647000030");
    const me = (await getSession(here))!.userId;
    expect(await hasPassword(me)).toBe(true);
    await db.account.updateMany({ where: { userId: me }, data: { password: null } }); // as an SMS-code account
    expect(await hasPassword(me)).toBe(false);
    expect(await change(here, PASSWORD)).toEqual({ ok: false, error: "INVALID_CURRENT_PASSWORD" });
    expect((await events("password_change_failed")).at(-1)).toMatchObject({ userId: me, reason: "no_password" });
  });

  it("5 tries an hour per user, then refused even with the right password; sign-in still works, and a success resets", async () => {
    const here = await signUp("0647000040");
    for (let i = 0; i < 4; i++) await change(here, "not the password");
    expect(await change(here, PASSWORD)).toEqual({ ok: true, value: undefined }); // the 5th try
    expect(await db.rateLimitHit.count({ where: { key: { startsWith: "changePassword:" } } })).toBe(0); // reset

    for (let i = 0; i < 5; i++) await change(here, "not the password");
    expect(await change(here, NEW, "another long phrase")).toEqual({ ok: false, error: "TOO_MANY_REQUESTS" });
    expect((await events("rate_limited")).at(-1)).toMatchObject({ reason: "changePassword:user", phone: "+2126•••••40" });
    expect((await signIn("0647000040", NEW)).status).toBe(200); // the account never locks
  });

  it("per IP once a proxy is trusted (20 / h), across users", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const here = cookieOf(await post(signUpRoute, "sign-up", { firstName: "Karim", lastName: "Ben Ahmed", phone: "0647000050", password: PASSWORD, locale: "fr" }), "105.66.9.9");
    await db.rateLimitHit.createMany({ data: Array.from({ length: 20 }, () => ({ key: "changePassword:ip:3600:105.66.9.9" })) });
    expect(await change(here, PASSWORD)).toEqual({ ok: false, error: "TOO_MANY_REQUESTS" });
    expect((await events("rate_limited")).at(-1)).toMatchObject({ reason: "changePassword:ip", ip: "105.66.9.0/24" });
    here.set("x-forwarded-for", "105.66.8.8");
    expect(await change(here, PASSWORD)).toEqual({ ok: true, value: undefined });
  });
});
