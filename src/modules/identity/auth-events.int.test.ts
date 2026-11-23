import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as requestRoute } from "@/app/api/auth/request-code/route";
import { POST as verifyRoute } from "@/app/api/auth/verify-code/route";
import { db } from "@/lib/db";
import { recordAuthEvent } from "@/modules/identity";

// poultry-auth §6: one AuthEvent per request on the login endpoints, with the masked phone, the coarse IP and the user
// agent, and never a code, session id or captcha payload. Real requests to the route handlers.
const UA = "Mozilla/5.0 (Linux; Android 10; K) audit-test";
const IP = "105.66.7.42";
const SUBNET = "105.66.7.0/24";

const request = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/auth/${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "x-requested-with": "poultry",
      "content-type": "application/json",
      "user-agent": UA,
      "x-forwarded-for": IP,
      ...extra,
    },
    body: JSON.stringify(body),
  });

const latestCode = async (e164: string) =>
  (await db.verification.findFirst({ where: { identifier: `phone-number-otp-${e164}` }, orderBy: { createdAt: "desc" } }))!.value.split(":")[0];
const events = () => db.authEvent.findMany({ orderBy: { id: "asc" } });
const common = { phone: "+2126•••••21", ip: SUBNET, userAgent: UA };

// Values that must never reach an auth event: filled by each test, checked after it.
let secrets: string[] = [];

beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  await db.authEvent.deleteMany();
  await db.rateLimitHit.deleteMany();
  secrets = [];
});
afterEach(async () => {
  const stored = JSON.stringify(await events());
  for (const secret of secrets) expect(stored).not.toContain(secret);
  expect(stored).not.toContain(IP); // the subnet only
  vi.unstubAllEnvs();
});

describe("auth events (poultry-auth §6)", () => {
  it("request-code, eligible number: code_requested, eligible", async () => {
    expect((await requestRoute(request("request-code", { phone: "0621212121" }))).status).toBe(202);
    secrets.push(await latestCode("+212621212121"));
    expect(await events()).toMatchObject([{ action: "code_requested", reason: "eligible", userId: null, ...common }]);
  });

  it("request-code, number not eligible: code_requested, invalid_phone, no phone kept", async () => {
    expect((await requestRoute(request("request-code", { phone: "+33612345678" }))).status).toBe(202);
    expect(await events()).toMatchObject([{ action: "code_requested", reason: "invalid_phone", phone: null, ip: SUBNET, userAgent: UA }]);
    secrets.push("612345678");
  });

  it("request-code blocked on the number: same 202, rate_limited", async () => {
    for (let i = 0; i < 4; i++) expect((await requestRoute(request("request-code", { phone: "0621212121" }))).status).toBe(202);
    const rows = await events();
    expect(rows.map((e) => e.action)).toEqual(["code_requested", "code_requested", "code_requested", "rate_limited"]);
    expect(rows[3]).toMatchObject({ reason: "requestCode:phone", ...common });
  });

  it("request-code flood from one IP: 429, rate_limited on the IP", async () => {
    for (let i = 0; i < 20; i++) await requestRoute(request("request-code", { phone: "+33600000000" }));
    const res = await requestRoute(request("request-code", { phone: "0621212121" }));
    expect(res.status).toBe(429);
    const rows = await events();
    expect(rows).toHaveLength(21);
    expect(rows[20]).toMatchObject({ action: "rate_limited", reason: "requestCode:ip", ...common });
  });

  it("captcha failure on request-code and on verify-code, payload not kept", async () => {
    vi.stubEnv("CAPTCHA_DISABLED", "");
    vi.stubEnv("CAPTCHA_HMAC_KEY", "test-only-captcha-key");
    const captcha = { challenge: { signature: "captcha-payload-marker" }, solution: { counter: 1 } };
    secrets.push("captcha-payload-marker");

    expect((await requestRoute(request("request-code", { phone: "0621212121", captcha }))).status).toBe(400);
    expect(await events()).toMatchObject([{ action: "captcha_failed", reason: "requestCode", ...common }]);

    await db.authEvent.deleteMany();
    for (let i = 0; i < 3; i++) await verifyRoute(request("verify-code", { phone: "0621212121", code: "000000" }));
    expect((await verifyRoute(request("verify-code", { phone: "0621212121", code: "000000", captcha }))).status).toBe(400);
    const rows = await events();
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({ action: "captcha_failed", reason: "verifyCode", ...common });
  });

  it("verify-code: a wrong code, then the right one (login), then logout", async () => {
    await requestRoute(request("request-code", { phone: "0621212121" }));
    const code = await latestCode("+212621212121");
    secrets.push(code);
    await db.authEvent.deleteMany();

    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verifyRoute(request("verify-code", { phone: "0621212121", code: wrong, locale: "fr" }))).status).toBe(401);
    expect(await events()).toMatchObject([{ action: "verify_failed", reason: "wrong_code", userId: null, ...common }]);

    const ok = await verifyRoute(request("verify-code", { phone: "0621212121", code, locale: "fr" }));
    expect(ok.status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212621212121" } });
    const session = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    const cookie = ok.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    secrets.push(session.id, session.token, cookie.split("=")[1]);
    expect((await events())[1]).toMatchObject({ action: "login", reason: null, userId: user.id, ...common });

    expect((await logoutRoute(request("logout", {}, { cookie }))).status).toBe(200);
    const rows = await events();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ action: "logout", reason: null, userId: user.id, ...common });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("verify-code without a code requested, or a malformed code: verify_failed with the reason", async () => {
    expect((await verifyRoute(request("verify-code", { phone: "0621212121", code: "123456" }))).status).toBe(401);
    expect((await verifyRoute(request("verify-code", { phone: "0621212121", code: "12ab" }))).status).toBe(401);
    expect((await events()).map((e) => e.reason)).toEqual(["no_code", "malformed_code"]);
  });

  it("a failed write is logged and never thrown, so login goes on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAuthEvent("login", {}, { userId: "not-a-uuid" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[auth-event\] login not recorded: \S+$/);
    expect(String(log.mock.calls[0][0])).not.toContain("not-a-uuid"); // the row's values stay out of the log
    log.mockRestore();
  });

  it("logout without a session writes nothing", async () => {
    expect((await logoutRoute(request("logout", {}))).status).toBe(200);
    expect(await events()).toEqual([]);
  });
});
