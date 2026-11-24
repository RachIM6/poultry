import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "./route";

// connection() needs Next's request scope, absent here: it only keeps the route out of build-time prerendering.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

afterEach(() => vi.restoreAllMocks());

it("200 ok when the database answers, never cached", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok" });
});

it("503 unavailable, with no details, when the database query fails", async () => {
  vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toBe(JSON.stringify({ status: "unavailable" }));
});
