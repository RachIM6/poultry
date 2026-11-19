import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { SCOPE_HEADER } from "@/lib/sync/protocol";
import { requestCode, verifyCode } from "@/modules/identity";
import { tenant } from "@/test/tenant";
import { GET } from "./pull/route";
import { POST } from "./push/route";

// Route-level rules: CSRF, session, scope, validation, limits. Push/pull semantics: src/lib/sync/server.int.test.ts.
const origin = process.env.APP_ORIGIN!;

/** The headers a signed-in phone sends: its session cookie and the scope of its local database. */
async function signedIn(phone: string) {
  const ctx = await tenant(`+212${phone.slice(1)}`);
  await requestCode(phone, {});
  const code = (await db.verification.findFirstOrThrow({ where: { identifier: `+212${phone.slice(1)}` } })).value.split(":")[0];
  const res = await verifyCode(phone, code, "fr", {});
  if (!res.ok) throw new Error(res.error);
  const cookie = res.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { cookie, [SCOPE_HEADER]: `${ctx.userId}:${ctx.organizationId}` };
}

const pushReq = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/sync/push`, { method: "POST", body, headers: { origin, "x-requested-with": "poultry", ...headers } });
const pullReq = (query: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/sync/pull${query}`, { headers });

describe("sync endpoints", () => {
  it("refuse cross-site pushes and callers without a session", async () => {
    expect((await POST(new Request(`${origin}/api/sync/push`, { method: "POST", body: "{}" }))).status).toBe(403);
    expect((await POST(pushReq(JSON.stringify({ mutations: [] })))).status).toBe(401);
    expect((await GET(pullReq("?since=0"))).status).toBe(401);
  });

  it("refuse a local database that belongs to another user or organisation (shared phone)", async () => {
    const auth = await signedIn("0640000003");
    const other = { ...auth, [SCOPE_HEADER]: "0190a000-0000-7000-8000-000000000001:0190a000-0000-7000-8000-000000000002" };
    const missing = { cookie: auth.cookie };
    for (const headers of [other, missing]) {
      expect((await POST(pushReq(JSON.stringify({ mutations: [] }), headers))).status).toBe(409);
      expect((await GET(pullReq("?since=0", headers))).status).toBe(409);
    }
    expect((await GET(pullReq("?since=0", auth))).status).toBe(200);
  });

  it("validate the body and the cursor, and reject unknown mutation types per mutation", async () => {
    const auth = await signedIn("0640000001");
    expect((await POST(pushReq("not json", auth))).status).toBe(400);
    expect((await POST(pushReq(JSON.stringify({ mutations: [{ id: "x" }] }), auth))).status).toBe(400);
    expect((await GET(pullReq("?since=-1", auth))).status).toBe(400);

    const m = { id: "0190a000-0000-7000-8000-00000000abcd", type: "flock.nope", payload: {}, createdAt: "2026-10-29T08:00:00Z" };
    const res = await POST(pushReq(JSON.stringify({ mutations: [m] }), auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ id: m.id, status: "rejected", messageKey: "errors.UNKNOWN_MUTATION" }] });

    const pulled = await GET(pullReq("?since=0", auth));
    expect(pulled.headers.get("cache-control")).toBe("no-store");
    expect(await pulled.json()).toEqual({ version: 0, hasMore: false, changes: [] });
  });

  it("cap pushes at 500 mutations and 120 requests a minute per user", async () => {
    const auth = await signedIn("0640000002");
    const many = Array.from({ length: 501 }, (_, i) => ({
      id: `0190a000-0000-7000-8000-${String(i).padStart(12, "0")}`, type: "x.y", payload: {}, createdAt: "2026-10-29T08:00:00Z",
    }));
    expect((await POST(pushReq(JSON.stringify({ mutations: many }), auth))).status).toBe(400);
    const huge = JSON.stringify({ mutations: [], pad: "x".repeat(2_000_001) });
    expect((await POST(pushReq(huge, { ...auth, "content-length": String(huge.length) }))).status).toBe(413); // declared length
    const streamed = new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(huge)), c.close()) });
    const noLength = new Request(`${origin}/api/sync/push`, {
      method: "POST", body: streamed, duplex: "half", headers: { origin, "x-requested-with": "poultry", ...auth },
    } as RequestInit);
    expect((await POST(noLength)).status).toBe(413); // counted while reading
    for (let i = 0; i < 117; i++) await POST(pushReq(JSON.stringify({ mutations: [] }), auth));
    expect((await POST(pushReq(JSON.stringify({ mutations: [] }), auth))).status).toBe(429);
  });
});
