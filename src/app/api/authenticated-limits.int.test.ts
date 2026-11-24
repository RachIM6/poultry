import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { requestCode, verifyCode } from "@/modules/identity";
import { tenant } from "@/test/tenant";
import { GET as readFile } from "./files/[id]/route";
import { GET as exportBooks } from "./finance/export/route";
import { POST as setQuietHours } from "./notifications/quiet-hours/route";
import { POST as testNotification } from "./notifications/test/route";
import { POST as subscribe } from "./push/subscribe/route";

// The test route pushes after the response with after(): nothing to send here.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));

// poultry-auth rate-limiting.md §3 "Authenticated default", §7: costly signed-in endpoints answer 429 + Retry-After
// past their policy (src/lib/security/policies.ts), per session and per user, audit the block, and leave others alone.
const origin = process.env.APP_ORIGIN!;

/** A fresh session cookie for this number (a second call is a second device). */
async function login(phone: string) {
  await requestCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `phone-number-otp-+212${phone.slice(1)}` } })).value.split(":")[0];
  const res = await verifyCode(phone, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  return { cookie: res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}

const post = (path: string, headers: Record<string, string>) =>
  new Request(`${origin}${path}`, { method: "POST", body: "{}", headers: { origin, "x-requested-with": "poultry", "content-type": "application/json", ...headers } });
const get = (path: string, headers: Record<string, string>) => new Request(`${origin}${path}`, { headers });
const noFile = "0190a000-0000-7000-8000-000000000099";

/** Calls `n` times and returns the statuses. */
const times = async (n: number, call: () => Promise<Response>) => {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await call()).status);
  return statuses;
};

describe("rate limits on costly signed-in endpoints", () => {
  let a: { cookie: string }, b: { cookie: string };
  let aUserId: string;

  beforeAll(async () => {
    aUserId = (await tenant("+212670000001")).userId;
    await tenant("+212670000002");
    a = await login("0670000001");
    b = await login("0670000002");
  });

  it("the books export: 5 a minute per session, 10 per user, audited; another user is unaffected", async () => {
    const call = (h: { cookie: string }) => exportBooks(get("/api/finance/export?month=2026-10", h));
    expect((await times(5, () => call(a))).filter((s) => s === 429)).toEqual([]);
    const blocked = await call(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(await blocked.json()).toEqual({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" });
    expect(await db.authEvent.count({ where: { action: "rate_limited", userId: aUserId, reason: "financeExport:session" } })).toBe(1);

    // A second device of the same user has its own session budget, up to the user's 10 (6 already counted).
    const a2 = await login("0670000001");
    expect(await times(4, () => call(a2))).not.toContain(429);
    expect((await call(a2)).status).toBe(429);
    expect(await db.authEvent.count({ where: { action: "rate_limited", userId: aUserId, reason: "financeExport:user" } })).toBe(1);

    expect((await call(b)).status).not.toBe(429);
  });

  it("a stored file: 60 a minute per session", async () => {
    const call = (h: { cookie: string }) => readFile(get(`/api/files/${noFile}`, h), { params: Promise.resolve({ id: noFile }) });
    expect(await times(60, () => call(a))).not.toContain(429);
    const blocked = await call(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await call(b)).status).toBe(404);
  });

  it("the test notification: 3 a minute per session", async () => {
    const call = (h: { cookie: string }) => testNotification(post("/api/notifications/test", h));
    expect(await times(3, () => call(a))).toEqual([201, 201, 201]);
    const blocked = await call(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await call(b)).status).toBe(201);
  });

  it("push subscriptions: 10 an hour per session", async () => {
    const call = (h: { cookie: string }) => subscribe(post("/api/push/subscribe", h)); // "{}": counted, then refused as invalid
    expect(await times(10, () => call(a))).not.toContain(429);
    const blocked = await call(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect((await call(b)).status).toBe(400);
  });

  it("quiet hours: the authenticated default, 300 a minute per session", async () => {
    const call = (h: { cookie: string }) => setQuietHours(post("/api/notifications/quiet-hours", h));
    expect(await times(300, () => call(a))).not.toContain(429);
    const blocked = await call(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await call(b)).status).toBe(400);
  });

  it("answers 401 without a session", async () => {
    expect((await exportBooks(get("/api/finance/export?month=2026-10", {}))).status).toBe(401);
  });
});
