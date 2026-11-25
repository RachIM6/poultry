import { afterEach, describe, expect, it } from "vitest";
import { GET as dispatchGet, POST as dispatch } from "./dispatch/route";

const origin = process.env.APP_ORIGIN!;
const call = (authorization?: string) =>
  dispatch(new Request(`${origin}/api/push/dispatch`, { method: "POST", headers: authorization ? { authorization } : {} }));

describe("POST /api/push/dispatch", () => {
  afterEach(() => void delete process.env.CRON_SECRET);

  it("doesn't exist without CRON_SECRET, and answers only the scheduler's exact token", async () => {
    expect((await call("Bearer anything")).status).toBe(404);
    process.env.CRON_SECRET = "s3cret-for-tests";
    expect((await call()).status).toBe(404);
    expect((await call("Bearer wrong-token-xyz")).status).toBe(404);
    const ok = await call("Bearer s3cret-for-tests");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: ["vaccinationReminders", "instrumentReminders", "issuedReminders", "placementReminders", "documentReminders", "loanReminders", "postings", "pushes"],
      failed: [],
    });
  });
});

// Vercel Cron calls the path with GET and "Authorization: Bearer <CRON_SECRET>" (docs/deploy-vercel-supabase.md).
describe("GET /api/push/dispatch (Vercel Cron)", () => {
  afterEach(() => void delete process.env.CRON_SECRET);
  const get = (authorization?: string) => dispatchGet(new Request(`${origin}/api/push/dispatch`, { headers: authorization ? { authorization } : {} }));

  it("runs the same steps behind the same token check", async () => {
    expect((await get("Bearer anything")).status).toBe(404);
    process.env.CRON_SECRET = "s3cret-for-tests";
    expect((await get()).status).toBe(404);
    expect((await get("bearer s3cret-for-tests")).status).toBe(404);
    const ok = await get("Bearer s3cret-for-tests");
    expect(ok.status).toBe(200);
    expect((await ok.json()).failed).toEqual([]);
  });
});
