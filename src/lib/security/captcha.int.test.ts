import { solveChallenge, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/request-code/route";
import { POST as verifyRoute } from "@/app/api/auth/verify-code/route";
import { GET as challengeRoute } from "@/app/api/captcha/challenge/route";
import { db } from "@/lib/db";
import { assertCaptchaConfig, createCaptchaChallenge, verifyCaptcha } from "@/lib/security/captcha";

// vitest.config.ts disables the captcha for the int suite's login helpers: switch it back on here.
beforeEach(() => {
  vi.stubEnv("CAPTCHA_DISABLED", "");
  vi.stubEnv("CAPTCHA_HMAC_KEY", "test-only-captcha-key");
  vi.stubEnv("CAPTCHA_MAX_NUMBER", "3");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function solved(): Promise<Payload> {
  const challenge = await createCaptchaChallenge();
  const solution = await solveChallenge({ challenge, deriveKey });
  return { challenge, solution: solution! };
}

it("accepts a solved challenge once, then refuses the replay", async () => {
  const payload = await solved();
  expect(await verifyCaptcha(payload)).toBe(true);
  expect(await verifyCaptcha(payload)).toBe(false);
  expect(await db.captchaUse.count()).toBe(1);
});

it("lets exactly one of two concurrent replays through", async () => {
  const payload = await solved();
  const results = await Promise.all([verifyCaptcha(payload), verifyCaptcha(payload)]);
  expect(results.sort()).toEqual([false, true]);
});

it("refuses an expired challenge, and purges used challenges once expired", async () => {
  const used = await solved();
  expect(await verifyCaptcha(used)).toBe(true);
  const late = await solved();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 5 * 60_000 + 1_000);
  expect(await verifyCaptcha(late)).toBe(false);
  expect(await verifyCaptcha(await solved())).toBe(true); // a fresh one works and clears the expired row
  expect(await db.captchaUse.count({ where: { expiresAt: { lt: new Date() } } })).toBe(0);
});

it("refuses tampered challenges, wrong solutions, other keys and malformed payloads", async () => {
  const { challenge, solution } = await solved();
  const easier = { ...challenge, parameters: { ...challenge.parameters, cost: 1 } };
  expect(await verifyCaptcha({ challenge: easier, solution })).toBe(false);
  expect(await verifyCaptcha({ challenge, solution: { ...solution, counter: solution.counter + 1 } })).toBe(false);
  expect(await verifyCaptcha({ challenge, solution: { ...solution, derivedKey: "00".repeat(32) } })).toBe(false);
  expect(await verifyCaptcha({ challenge: { parameters: challenge.parameters }, solution })).toBe(false); // unsigned

  vi.stubEnv("CAPTCHA_HMAC_KEY", "another-key");
  expect(await verifyCaptcha({ challenge, solution })).toBe(false);

  for (const junk of [undefined, null, "", "true", 42, {}, { challenge: null, solution: null }, { challenge: { parameters: "x" } }]) {
    expect(await verifyCaptcha(junk)).toBe(false);
  }
});

it("POST /api/auth/request-code without a captcha: 400 errors.CAPTCHA_REQUIRED, and no number budget spent", async () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost:3000/api/auth/request-code", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "x-requested-with": "poultry", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  for (const captcha of [undefined, { challenge: {}, solution: {} }]) {
    const res = await post({ phone: "0655555555", captcha });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, messageKey: "errors.CAPTCHA_REQUIRED" });
  }
  expect(await db.verification.count({ where: { identifier: "phone-number-otp-+212655555555" } })).toBe(0);
  expect(await db.rateLimitHit.count({ where: { key: { startsWith: "requestCode:phone:" } } })).toBe(0);

  expect((await post({ phone: "0655555555", captcha: await solved() })).status).toBe(202);
  expect(await db.verification.count({ where: { identifier: "phone-number-otp-+212655555555" } })).toBe(1);
});

it("GET /api/captcha/challenge: past the IP limit, 429 and no challenge", async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  const get = () => challengeRoute(new Request("http://localhost:3000/api/captcha/challenge", { headers: { "x-forwarded-for": "105.66.9.9" } }));
  for (let i = 0; i < 30; i++) expect(Object.keys(await (await get()).json())).toEqual(["parameters", "signature"]);

  const blocked = await get();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBe("900");
  expect(await blocked.json()).toEqual({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" });
});

it("CAPTCHA_DISABLED=true accepts anything outside production only", async () => {
  vi.stubEnv("CAPTCHA_DISABLED", "true");
  expect(await verifyCaptcha(undefined)).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(await verifyCaptcha(undefined)).toBe(false);
});

it("refuses to start in production with the captcha disabled or without a key", () => {
  expect(() => assertCaptchaConfig({ NODE_ENV: "production", CAPTCHA_HMAC_KEY: "k", CAPTCHA_DISABLED: "true" })).toThrow(/CAPTCHA_DISABLED/);
  expect(() => assertCaptchaConfig({ NODE_ENV: "production" })).toThrow(/CAPTCHA_HMAC_KEY/);
  expect(() => assertCaptchaConfig({ NODE_ENV: "production", CAPTCHA_HMAC_KEY: "k" })).not.toThrow();
  expect(() => assertCaptchaConfig({ NODE_ENV: "test", CAPTCHA_DISABLED: "true" })).not.toThrow();
});

// Adaptive captcha on verify-code (references/rate-limiting.md §4): from the 3rd consecutive failure per number or IP.
const authRequest = (path: string, body: unknown, ip?: string) =>
  new Request(`http://localhost:3000/api/auth/${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "x-requested-with": "poultry",
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify(body),
  });
const verify = async (body: { phone: string; code: string; captcha?: unknown }, ip?: string) => {
  const res = await verifyRoute(authRequest("verify-code", { locale: "fr", ...body }, ip));
  return { status: res.status, messageKey: ((await res.json()) as { messageKey?: string }).messageKey };
};
const sendCode = async (phone: string, e164: string) => {
  expect((await POST(authRequest("request-code", { phone, captcha: await solved() }))).status).toBe(202);
  const code = (await db.verification.findFirst({ where: { identifier: `phone-number-otp-${e164}` }, orderBy: { createdAt: "desc" } }))!.value.split(":")[0];
  return { code, wrong: code === "000000" ? "111111" : "000000" };
};
const verifyBudget = () => db.rateLimitHit.count({ where: { key: { startsWith: "verifyCode:phone:" } } });
const INVALID = { status: 401, messageKey: "errors.INVALID_OR_EXPIRED_CODE" };
const REQUIRED = { status: 400, messageKey: "errors.CAPTCHA_REQUIRED" };

it("verify-code after 3 wrong codes: a captcha is required and spares the number's budget; a success resets the count", async () => {
  const { code, wrong } = await sendCode("0612121212", "+212612121212");
  for (let i = 0; i < 3; i++) expect(await verify({ phone: "0612121212", code: wrong })).toEqual(INVALID);

  const spent = await verifyBudget();
  expect(await verify({ phone: "0612121212", code })).toEqual(REQUIRED);
  expect(await verify({ phone: "0612121212", code, captcha: { challenge: {}, solution: {} } })).toEqual(REQUIRED);
  expect(await verifyBudget()).toBe(spent); // refused before the per-number limit: wrong codes can't lock the farmer out

  expect(await verify({ phone: "0612121212", code, captcha: await solved() })).toMatchObject({ status: 200 });

  // Back to normal: two wrong codes, then the right one without a captcha.
  const next = await sendCode("0612121212", "+212612121212");
  for (let i = 0; i < 2; i++) expect(await verify({ phone: "0612121212", code: next.wrong })).toEqual(INVALID);
  expect(await verify({ phone: "0612121212", code: next.code })).toMatchObject({ status: 200 });
});

it("verify-code refuses a captcha payload used once already", async () => {
  const { wrong } = await sendCode("0613131313", "+212613131313");
  for (let i = 0; i < 3; i++) await verify({ phone: "0613131313", code: wrong });
  const captcha = await solved();
  expect(await verify({ phone: "0613131313", code: wrong, captcha })).toEqual(INVALID); // accepted, then the code is wrong
  expect(await verify({ phone: "0613131313", code: wrong, captcha })).toEqual(REQUIRED);
});

it("verify-code: 3 failures from one IP on different numbers require a captcha from that IP only", async () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  for (const phone of ["0614141401", "0614141402", "0614141403"]) expect(await verify({ phone, code: "000000" }, "105.66.4.4")).toEqual(INVALID);
  expect(await verify({ phone: "0614141404", code: "000000" }, "105.66.4.4")).toEqual(REQUIRED);
  expect(await verify({ phone: "0614141404", code: "000000" }, "105.66.5.5")).toEqual(INVALID);
});
