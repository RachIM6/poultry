import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fixedClock } from "@/lib/kernel/clock";
import { getSession, logout, requestCode, verifyCode } from "@/modules/identity";

// Codes come from the Verification row (Better Auth stores "<code>:<attempts>").
const latestCode = async (e164: string) =>
  (await db.verification.findFirst({ where: { identifier: e164 }, orderBy: { createdAt: "desc" } }))?.value.split(":")[0];

const cookieHeader = (setCookie: Headers) =>
  new Headers({ cookie: setCookie.getSetCookie().map((c) => c.split(";")[0]).join("; ") });

const login = async (phone: string, e164: string) => {
  await requestCode(phone, {});
  const res = await verifyCode(phone, (await latestCode(e164))!, "fr", {});
  if (!res.ok) throw new Error(res.error);
  return res.value;
};

describe("phone + code login (SPEC I1–I2)", () => {
  it("signs up on first login, with a Secure HttpOnly SameSite=Lax session cookie", async () => {
    const setCookie = await login("06 11 11 11 11", "+212611111111");

    const sid = setCookie.getSetCookie().find((c) => c.startsWith("__Secure-sid="))!;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/Secure/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(sid).toMatch(/Path=\//i);

    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: "+212611111111" } });
    expect(user.locale).toBe("fr");
    expect(await getSession(cookieHeader(setCookie))).toMatchObject({ userId: user.id, phone: "+212611111111" });
  });

  it("locks the code after 5 wrong attempts, even for the right code", async () => {
    await requestCode("0622222222", {});
    const code = (await latestCode("+212622222222"))!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await verifyCode("0622222222", wrong, "ar", {})).toEqual({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });

    expect(await verifyCode("0622222222", code, "ar", {})).toEqual({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });
  });

  it("sends no 4th code within 15 min, with the same answer", async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) {
      expect(await requestCode("0633333333", {})).toBe("sent_if_eligible");
      codes.push(await db.verification.count({ where: { identifier: "+212633333333" } }));
    }
    expect(codes).toEqual([1, 2, 3, 3]);
  });

  it("never sends to a non-Moroccan or landline number, with the same answer", async () => {
    expect(await requestCode("+33612345678", {})).toBe("sent_if_eligible");
    expect(await requestCode("0522123456", {})).toBe("sent_if_eligible");
    expect(await db.verification.count({ where: { identifier: { in: ["+33612345678", "0522123456"] } } })).toBe(0);
  });

  it("rejects an expired code", async () => {
    await requestCode("0644444444", {});
    const code = (await latestCode("+212644444444"))!;
    await db.verification.updateMany({ where: { identifier: "+212644444444" }, data: { expiresAt: new Date(0) } });
    expect(await verifyCode("0644444444", code, "ar", {})).toEqual({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });
  });

  it("logout deletes the session on the server", async () => {
    const cookie = cookieHeader(await login("0655555555", "+212655555555"));
    await logout(cookie);
    expect(await getSession(cookie)).toBeNull();
  });

  it("ends a session 90 days after login even if it kept sliding", async () => {
    const cookie = cookieHeader(await login("0666666666", "+212666666666"));
    const ninetyOneDaysLater = fixedClock(new Date(Date.now() + 91 * 86_400_000).toISOString());
    expect(await getSession(cookie, ninetyOneDaysLater)).toBeNull();
    expect(await getSession(cookie)).toBeNull(); // the row is gone, not just hidden
  });
});
