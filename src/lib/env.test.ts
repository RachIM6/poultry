import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "./env";

const SECRET = "a-random-test-value-of-32-chars!"; // exactly 32
const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db:5432/poultry",
  APP_ORIGIN: "https://ferme.example",
  BETTER_AUTH_SECRET: SECRET,
  CAPTCHA_HMAC_KEY: SECRET,
  TRUSTED_PROXY_HOPS: "1",
  CRON_SECRET: "cron",
} as NodeJS.ProcessEnv;

const check = (changes: Record<string, string | undefined>) => () => checkProductionEnv({ ...GOOD, ...changes });

describe("checkProductionEnv", () => {
  it("passes a complete production configuration without warnings", () => {
    expect(checkProductionEnv(GOOD)).toEqual([]);
  });

  it("checks nothing outside production", () => {
    expect(checkProductionEnv({ NODE_ENV: "development", OTP_CONSOLE_SINK: "1" } as NodeJS.ProcessEnv)).toEqual([]);
    expect(checkProductionEnv({ NODE_ENV: "test", CAPTCHA_DISABLED: "true" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("refuses a missing DATABASE_URL", () => {
    expect(check({ DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it.each([undefined, "", "http://ferme.example", "https://ferme.example/", "https://ferme.example/app", "ferme.example", "http://localhost:3000"])(
    "refuses APP_ORIGIN %s",
    (origin) => expect(check({ APP_ORIGIN: origin })).toThrow(/APP_ORIGIN/),
  );

  it.each(["BETTER_AUTH_SECRET", "CAPTCHA_HMAC_KEY"])("refuses %s missing, the placeholder or under 32 characters", (name) => {
    for (const value of [undefined, "", "dev-only-replace-me-with-32-random-bytes", SECRET.slice(1)]) {
      expect(check({ [name]: value }), String(value)).toThrow(new RegExp(name));
    }
  });

  it("refuses CAPTCHA_DISABLED=true", () => {
    expect(check({ CAPTCHA_DISABLED: "true" })).toThrow(/CAPTCHA_DISABLED/);
  });

  it("refuses TRUSTED_PROXY_HOPS unset, and warns when it is 0", () => {
    expect(check({ TRUSTED_PROXY_HOPS: undefined })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(check({ TRUSTED_PROXY_HOPS: "" })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(check({ TRUSTED_PROXY_HOPS: "0" })()).toEqual([expect.stringMatching(/TRUSTED_PROXY_HOPS=0/)]);
  });

  it("refuses a half-set VAPID pair, and keys without a subject", () => {
    expect(check({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub" })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(check({ VAPID_PRIVATE_KEY: "priv" })).toThrow(/NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
    expect(check({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toThrow(/VAPID_SUBJECT/);
    expect(check({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.ma" })()).toEqual([]);
    expect(check({ VAPID_SUBJECT: "mailto:a@b.ma" })()).toEqual([]); // no keys: push off
  });

  it("warns without CRON_SECRET", () => {
    expect(check({ CRON_SECRET: undefined })()).toEqual([expect.stringMatching(/CRON_SECRET/)]);
  });

  it("refuses OTP_CONSOLE_SINK, unless CI's test server escape is on with CI set", () => {
    expect(check({ OTP_CONSOLE_SINK: "1" })).toThrow(/OTP_CONSOLE_SINK/);
    expect(check({ OTP_CONSOLE_SINK: "1", ALLOW_TEST_SERVER_IN_CI: "1" })).toThrow(/ALLOW_TEST_SERVER_IN_CI is only accepted when CI is set/);
    expect(check({ OTP_CONSOLE_SINK: "1", CI: "true" })).toThrow(/OTP_CONSOLE_SINK/);
    const ci = { OTP_CONSOLE_SINK: "1", ALLOW_TEST_SERVER_IN_CI: "1", CI: "true" };
    expect(check(ci)()).toEqual([]);
    // The escape also allows CI's http://localhost origin, and only a loopback one.
    expect(check({ ...ci, APP_ORIGIN: "http://localhost:3212" })()).toEqual([]);
    expect(check({ ...ci, APP_ORIGIN: "http://127.0.0.1:3212" })()).toEqual([]);
    expect(check({ ...ci, APP_ORIGIN: "http://ferme.example" })).toThrow(/APP_ORIGIN/);
  });

  it("lists every problem at once and never prints a value", () => {
    const leaked = "postgresql://secret-user:secret-pass@db/poultry";
    let message = "";
    try {
      checkProductionEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "short-secret-value", APP_ORIGIN: leaked } as NodeJS.ProcessEnv);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const name of ["DATABASE_URL", "APP_ORIGIN", "BETTER_AUTH_SECRET", "CAPTCHA_HMAC_KEY", "TRUSTED_PROXY_HOPS"]) expect(message).toContain(name);
    expect(message).not.toContain("secret-pass");
    expect(message).not.toContain("short-secret-value");
  });
});
