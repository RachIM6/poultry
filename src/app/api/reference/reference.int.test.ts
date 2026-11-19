import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { requestCode, verifyCode } from "@/modules/identity";
import { tenant } from "@/test/tenant";
import { GET } from "./route";

const origin = process.env.APP_ORIGIN!;

describe("GET /api/reference (SPEC R4)", () => {
  it("needs a session, then answers 304 while the phone's copy is current", async () => {
    expect((await GET(new Request(`${origin}/api/reference`))).status).toBe(401);

    await tenant("+212650000001");
    await requestCode("0650000001", {});
    const code = (await db.verification.findFirstOrThrow({ where: { identifier: "+212650000001" } })).value.split(":")[0];
    const login = await verifyCode("0650000001", code, "fr", {});
    if (!login.ok) throw new Error(login.error);
    const cookie = login.value.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    const first = await GET(new Request(`${origin}/api/reference`, { headers: { cookie } }));
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ strains: [], products: [], protocolTemplates: [] });
    const etag = first.headers.get("etag")!;

    expect((await GET(new Request(`${origin}/api/reference`, { headers: { cookie, "if-none-match": etag } }))).status).toBe(304);
    await db.strain.create({ data: { id: "ross-308", name: "Ross 308" } });
    const changed = await GET(new Request(`${origin}/api/reference`, { headers: { cookie, "if-none-match": etag } }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });
});
