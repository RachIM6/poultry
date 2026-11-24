import { expect, it, vi } from "vitest";
import { onRequestError } from "./instrumentation";

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
  log.mockRestore();
});
