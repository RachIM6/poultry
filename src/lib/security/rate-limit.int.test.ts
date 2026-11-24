import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
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

it("gives every spelling of one IPv6 /64 the same key", () => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  const net = (ip: string) => clientNet(new Headers({ "x-forwarded-for": ip }));
  const expected = { ip: "2001:db8:0:0::/64", subnet: "2001:db8:0:0::/64" };
  for (const ip of ["2001:db8::1", "2001:0DB8:0:0::abcd", "2001:db8:0:0:1:2:3:4", "2001:db8::1%eth0"]) {
    expect(net(ip)).toEqual(expected);
  }
  expect(net("2001:db8:0:1::1")).not.toEqual(expected); // next /64 over
  expect(net("::ffff:105.66.1.20")).toEqual({ ip: "105.66.1.20", subnet: "105.66.1.0/24" });
  expect(net("not-an-ip")).toEqual({});
});

describe("the SMS cap alerts (300 codes / h, alerts at 150 and 300)", () => {
  // Distinct numbers and IPs, as in SMS pumping; none of them may reach the alert.
  const request = (i: number) =>
    consume("requestCode", { phone: `+2126${String(i).padStart(8, "0")}`, ip: `105.66.1.${i % 250}`, global: "sms" });
  const alerts = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.map((args) => String(args[0])).filter((line) => line.includes('"alert":"sms_cap_'));

  it("stays silent under 50 %, fires exactly once on crossing, and never with a phone or IP", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 1; i <= 149; i++) await request(i);
    expect(alerts(log)).toEqual([]);

    for (let i = 150; i <= 160; i++) await request(i);
    expect(alerts(log)).toEqual([JSON.stringify({ level: "error", alert: "sms_cap_50", count: 150, cap: 300, windowSec: 3600 })]);
    expect(alerts(log)[0]).not.toMatch(/\+212|105\.66/);
    log.mockRestore();
  });

  it("doesn't fire again when the sliding window dips under 50 % and crosses back", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const global = await db.rateLimitHit.findMany({ where: { key: "requestCode:global:3600:sms" }, orderBy: { id: "asc" }, take: 20 });
    await db.rateLimitHit.deleteMany({ where: { id: { in: global.map((h) => h.id) } } }); // 20 hits age out: 160 → 140
    for (let i = 161; i <= 171; i++) await request(i); // 140 → 151, through 150 again
    expect(alerts(log)).toEqual([]);
    log.mockRestore();
  });

  it("fires sms_cap_100 exactly once when the cap is reached, however many requests follow", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 172; i <= 330; i++) await request(i); // 151 → 310: the 300th code, then 10 refused
    expect(alerts(log)).toEqual([JSON.stringify({ level: "error", alert: "sms_cap_100", count: 300, cap: 300, windowSec: 3600 })]);
    expect(alerts(log)[0]).not.toMatch(/\+212|105\.66/);
    expect(await request(331)).toContain("global");
    log.mockRestore();
  });
});
