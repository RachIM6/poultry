import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { requestCode, verifyCode } from "@/modules/identity";
import { POST } from "./route";

// SPEC I3: the switcher's choice is saved on the user, through a CSRF-checked, signed-in endpoint.
const origin = process.env.APP_ORIGIN!;

async function signedIn(phone: string) {
  await requestCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-+212${phone.slice(1)}` } })).value.split(":")[0];
  const res = await verifyCode(phone, code, "ar", {});
  if (!res.ok) throw new Error(res.error);
  return res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const call = (body: unknown, headers: Record<string, string>) =>
  POST(new Request(`${origin}/api/locale`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }));
const sameOrigin = { origin, "x-requested-with": "poultry" };
const localeOf = (phoneNumber: string) => db.user.findUniqueOrThrow({ where: { phoneNumber } }).then((u) => u.locale);

describe("POST /api/locale", () => {
  it("saves the signed-in user's language", async () => {
    const cookie = await signedIn("0650000001");
    expect(await localeOf("+212650000001")).toBe("ar");
    const res = await call({ locale: "fr" }, { ...sameOrigin, cookie });
    expect(res.status).toBe(200);
    expect(await localeOf("+212650000001")).toBe("fr");
  });

  it("refuses a caller without a session", async () => {
    expect((await call({ locale: "fr" }, sameOrigin)).status).toBe(401);
  });

  it("refuses a cross-origin request, even with a session", async () => {
    const cookie = await signedIn("0650000002");
    expect((await call({ locale: "fr" }, { origin: "https://evil.example", "x-requested-with": "poultry", cookie })).status).toBe(403);
    expect((await call({ locale: "fr" }, { origin, cookie })).status).toBe(403); // no custom header: a cross-site form
    expect(await localeOf("+212650000002")).toBe("ar");
  });

  it("refuses any other language or body", async () => {
    const cookie = await signedIn("0650000003");
    for (const body of [{ locale: "ary" }, { locale: "en" }, {}, "fr", null]) {
      expect((await call(body, { ...sameOrigin, cookie })).status).toBe(400);
    }
    expect(await localeOf("+212650000003")).toBe("ar");
  });
});
