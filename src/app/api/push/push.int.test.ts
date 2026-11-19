import { afterEach, describe, expect, it } from "vitest";
import { POST as dispatch } from "./dispatch/route";

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
    expect(await ok.json()).toEqual({ sent: 0 });
  });
});
