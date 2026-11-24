import { afterEach, expect, it, vi } from "vitest";
import { onRequestError, register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("register exits with code 1 on an unsafe production configuration, logging names only", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "http://leaked-value.example");
  await register();
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log.mock.calls[0][0]).toMatch(/^Refusing to start in production:[\s\S]*APP_ORIGIN/);
  expect(log.mock.calls[0][0]).not.toContain("leaked-value");
});

it("register never exits outside production, even with an unsafe configuration", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("OTP_CONSOLE_SINK", "1");
  vi.stubEnv("APP_ORIGIN", "");
  await register(); // NODE_ENV is "test" under vitest
  expect(exit).not.toHaveBeenCalled();
});

it("onRequestError logs one JSON line without the query, headers or message", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const err = Object.assign(new TypeError("Ahmed Alaoui +212600000001"), { digest: "123" });
  const request = { path: "/api/sales?buyer=Ahmed", method: "POST", headers: { cookie: "session=abc" } };
  const context = { routerKind: "App Router", routePath: "/api/sales", routeType: "route", renderSource: undefined, revalidateReason: undefined } as const;
  await onRequestError(err, request, context as unknown as Parameters<typeof onRequestError>[2]);

  expect(log).toHaveBeenCalledOnce();
  const line = log.mock.calls[0][0] as string;
  expect(JSON.parse(line)).toEqual({ time: expect.any(String), path: "/api/sales", method: "POST", error: "TypeError", digest: "123" });
  for (const secret of ["Ahmed", "+212", "session"]) expect(line).not.toContain(secret);
});
