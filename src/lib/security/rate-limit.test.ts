import { afterEach, expect, it, vi } from "vitest";
import { clientNet } from "./rate-limit";

afterEach(() => vi.unstubAllEnvs());

it("reads the client from CLIENT_IP_HEADER alone when it is set, whatever X-Forwarded-For says", () => {
  vi.stubEnv("CLIENT_IP_HEADER", "x-vercel-forwarded-for");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  const net = (h: Record<string, string>) => clientNet(new Headers(h));
  expect(net({ "x-vercel-forwarded-for": "105.66.1.20", "x-forwarded-for": "6.6.6.6" })).toEqual({ ip: "105.66.1.20", subnet: "105.66.1.0/24" });
  expect(net({ "x-vercel-forwarded-for": "2001:db8::1" })).toEqual({ ip: "2001:db8:0:0::/64", subnet: "2001:db8:0:0::/64" });
  expect(net({ "x-forwarded-for": "105.66.1.20" })).toEqual({}); // the named header missing: no IP, no fallback
  expect(net({ "x-vercel-forwarded-for": "6.6.6.6, 105.66.1.20" })).toEqual({}); // not one address
  expect(net({ "x-vercel-forwarded-for": "not-an-ip" })).toEqual({});
});

it("falls back to X-Forwarded-For and the hops when CLIENT_IP_HEADER is unset or empty", () => {
  vi.stubEnv("CLIENT_IP_HEADER", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  expect(clientNet(new Headers({ "x-forwarded-for": "6.6.6.6, 105.66.1.20", "x-vercel-forwarded-for": "7.7.7.7" }))).toEqual({ ip: "105.66.1.20", subnet: "105.66.1.0/24" });
});
