import { afterEach, expect, it, vi } from "vitest";
import { postAllPending } from "@/modules/finance";
import { dispatchDuePushes } from "@/modules/notifications";
import { POST as dispatch } from "./dispatch/route";

vi.mock("@/modules/health", async (original) => ({
  ...(await original<typeof import("@/modules/health")>()),
  sendVaccinationReminders: vi.fn(async () => {
    throw new TypeError("no reminder for Fatima +212600000012"); // personal data that must not reach the log
  }),
}));
vi.mock("@/modules/finance", async (original) => {
  const finance = await original<typeof import("@/modules/finance")>();
  return { ...finance, postAllPending: vi.fn(finance.postAllPending) };
});
vi.mock("@/modules/notifications", async (original) => {
  const notifications = await original<typeof import("@/modules/notifications")>();
  return { ...notifications, dispatchDuePushes: vi.fn(notifications.dispatchDuePushes) };
});

afterEach(() => vi.unstubAllEnvs());

it("runs every step when one throws, lists it, answers 500 and logs no message", async () => {
  vi.stubEnv("CRON_SECRET", "s3cret-for-tests");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await dispatch(
    new Request(`${process.env.APP_ORIGIN}/api/push/dispatch`, { method: "POST", headers: { authorization: "Bearer s3cret-for-tests" } }),
  );

  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({
    ok: ["instrumentReminders", "issuedReminders", "placementReminders", "documentReminders", "loanReminders", "postings", "pushes", "retention"],
    failed: ["vaccinationReminders"],
  });
  expect(postAllPending).toHaveBeenCalledOnce();
  expect(dispatchDuePushes).toHaveBeenCalledOnce();
  expect(log.mock.calls).toEqual([
    [JSON.stringify({ level: "error", scheduler: "vaccinationReminders", error: "TypeError" })],
    [JSON.stringify({ level: "error", alert: "scheduler_failed", step: "vaccinationReminders" })],
  ]);
});
