import { afterEach, expect, it, vi } from "vitest";
import { clientNet, consume } from "@/lib/security/rate-limit";

it("lets exactly the limit through when requests arrive at the same time", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => consume("requestCode", { phone: "+212699999999" })));
  expect(results.filter((blocked) => blocked.length === 0)).toHaveLength(3); // SPEC I1: 3 per 15 min
  expect(results.filter((blocked) => blocked.includes("phone"))).toHaveLength(7);
});

it("keeps dimensions separate", async () => {
  for (let i = 0; i < 3; i++) await consume("requestCode", { phone: "+212688888888" });
  expect(await consume("requestCode", { phone: "+212688888888" })).toEqual(["phone"]);
  expect(await consume("requestCode", { phone: "+212677777777" })).toEqual([]);
});

afterEach(() => vi.unstubAllEnvs());

it("trusts X-Forwarded-For only behind a configured proxy", () => {
  const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 105.66.1.20" }); // spoofed entry, then what our proxy saw
  expect(clientNet(headers)).toEqual({});
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  expect(clientNet(headers)).toEqual({ ip: "105.66.1.20", subnet: "105.66.1.0/24" });
});
