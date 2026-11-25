import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { alertOps } from "./alert";

const log = vi.spyOn(console, "error").mockImplementation(() => {});
// alertOps loads next/server on first use; a server has it loaded already. Loading it here keeps the waits below short.
beforeAll(() => import("next/server"), 30_000);
beforeEach(() => log.mockClear());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("logs one line and posts nothing without a webhook", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  alertOps("sms_cap_50", { count: 150, cap: 300 });

  expect(log.mock.calls).toEqual([[JSON.stringify({ level: "error", alert: "sms_cap_50", count: 150, cap: 300 })]]);
  expect(fetch).not.toHaveBeenCalled();
});

it("posts the event as JSON to the webhook, with a 3 s timeout", async () => {
  vi.stubEnv("OPS_ALERT_WEBHOOK_URL", "https://hooks.example.test/T0/abc");
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  alertOps("scheduler_failed", { step: "postings" });

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://hooks.example.test/T0/abc");
  expect(init.method).toBe("POST");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(init.body as string)).toEqual({
    level: "error",
    alert: "scheduler_failed",
    step: "postings",
    text: "scheduler_failed step=postings",
    content: "scheduler_failed step=postings",
  });
});

it("never throws when the webhook fails, and logs no URL", async () => {
  vi.stubEnv("OPS_ALERT_WEBHOOK_URL", "https://hooks.example.test/T0/secret");
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed https://hooks.example.test/T0/secret"))));
  expect(() => alertOps("sms_cap_100", { count: 300 })).not.toThrow();
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
  expect(log.mock.calls[1]).toEqual([JSON.stringify({ level: "error", alertWebhook: "TypeError" })]);

  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  alertOps("sms_cap_100", { count: 300 });
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(4));
  expect(log.mock.calls[3]).toEqual([JSON.stringify({ level: "error", alertWebhook: 404 })]);
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
