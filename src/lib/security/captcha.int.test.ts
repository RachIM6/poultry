import { solveChallenge, type Payload } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/request-code/route";
import { GET as challengeRoute } from "@/app/api/captcha/challenge/route";
import { db } from "@/lib/db";
import { assertCaptchaConfig, createCaptchaChallenge, verifyCaptcha } from "@/lib/security/captcha";

// vitest.config.ts disables the captcha for the int suite's login helpers: switch it back on here.
beforeEach(() => {
  vi.stubEnv("CAPTCHA_DISABLED", "");
  vi.stubEnv("CAPTCHA_HMAC_KEY", "test-only-captcha-key");
  vi.stubEnv("CAPTCHA_MAX_NUMBER", "3");
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
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
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
