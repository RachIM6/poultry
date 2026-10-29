import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { requestCode, verifyCode } from "@/modules/identity";
import { tenant } from "@/test/tenant";
import { GET } from "./pull/route";
import { POST } from "./push/route";

// Route-level rules: CSRF, session, validation, limits. Push/pull semantics: src/lib/sync/server.int.test.ts.
const origin = process.env.APP_ORIGIN!;

async function signedIn(phone: string) {
  await tenant(`+212${phone.slice(1)}`);
  await requestCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `+212${phone.slice(1)}` } })).value.split(":")[0];
  const res = await verifyCode(phone, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  return res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

const pushReq = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/sync/push`, { method: "POST", body, headers: { origin, "x-requested-with": "poultry", ...headers } });
const pullReq = (query: string, cookie?: string) => new Request(`${origin}/api/sync/pull${query}`, { headers: cookie ? { cookie } : {} });

describe("sync endpoints", () => {
  it("refuse cross-site pushes and callers without a session", async () => {
    expect((await POST(new Request(`${origin}/api/sync/push`, { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await POST(pushReq(JSON.stringify({ mutations: [] })))).status).toBe(401);
    expect((await GET(pullReq("?since=0"))).status).toBe(401);
  });

  it("validate the body and the cursor, and reject unknown mutation types per mutation", async () => {
    const cookie = await signedIn("0640000001");
    expect((await POST(pushReq("not json", { cookie }))).status).toBe(400);
    expect((await POST(pushReq(JSON.stringify({ mutations: [{ id: "x" }] }), { cookie }))).status).toBe(400);
    expect((await GET(pullReq("?since=-1", cookie))).status).toBe(400);

    const m = { id: "0190a000-0000-7000-8000-00000000abcd", type: "flock.nope", payload: {}, createdAt: "2026-10-29T08:00:00Z" };
    const res = await POST(pushReq(JSON.stringify({ mutations: [m] }), { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: m.id, status: "rejected", messageKey: "errors.UNKNOWN_MUTATION" }] });

    const pulled = await GET(pullReq("?since=0", cookie));
    expect(pulled.headers.get("cache-control")).toBe("no-store");
    expect(await pulled.json()).toEqual({ version: 0, hasMore: false, changes: [] });
  });

  it("cap pushes at 500 mutations and 120 requests a minute per user", async () => {
    const cookie = await signedIn("0640000002");
    const many = Array.from({ length: 501 }, (_, i) => ({
      id: `0190a000-0000-7000-8000-${String(i).padStart(12, "0")}`, type: "x.y", payload: {}, createdAt: "2026-10-29T08:00:00Z",
    }));
    expect((await POST(pushReq(JSON.stringify({ mutations: many }), { cookie }))).status).toBe(400);
    for (let i = 0; i < 119; i++) await POST(pushReq(JSON.stringify({ mutations: [] }), { cookie }));
    expect((await POST(pushReq(JSON.stringify({ mutations: [] }), { cookie }))).status).toBe(429);
  });
});
