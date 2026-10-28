import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { db } from "@/lib/db";
import { POLICIES, type Dimension, type PolicyName } from "./policies";

/**
 * Counts this request on every dimension given and returns the dimensions now over their limit (empty = allowed).
 * Sliding window in Postgres, so limits are exact, survive restarts and are shared between instances.
 * Every dimension is counted even when another one already blocks, so the counters stay accurate.
 */
export async function consume(policy: PolicyName, dims: Partial<Record<Dimension, string>>): Promise<Dimension[]> {
  const rules = POLICIES[policy].filter((rule) => dims[rule.dim] !== undefined);
  const keys = rules.map((rule) => `${policy}:${rule.dim}:${rule.windowSec}:${keyValue(rule.dim, dims[rule.dim]!)}`);
  const windows = rules.map((rule) => rule.windowSec);

  // Two statements, one transaction. The lock comes first, so the second statement's snapshot (READ COMMITTED)
  // already sees every concurrent request of this policy: two requests can't both slip under a limit.
  // ponytail: one lock per policy serializes that endpoint's limiter (a few ms each); per-key locks if it ever queues.
  const [, counts] = await db.$transaction([
    db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${policy}))`,
    db.$queryRaw<{ key: string; n: number }[]>`
      WITH k AS (SELECT * FROM unnest(${keys}::text[], ${windows}::int[]) AS t(key, win)),
      pruned AS (DELETE FROM "RateLimitHit" h USING k WHERE h.key = k.key AND h.at <= now() - make_interval(secs => k.win)),
      added AS (INSERT INTO "RateLimitHit" (key) SELECT key FROM k)
      SELECT k.key, (SELECT count(*) FROM "RateLimitHit" h WHERE h.key = k.key AND h.at > now() - make_interval(secs => k.win))::int AS n
      FROM k`,
  ]);

  const countOf = new Map(counts.map((c) => [c.key, c.n])); // n = earlier hits in the window, this one excluded
  const blocked = new Set<Dimension>();
  rules.forEach((rule, i) => {
    const n = countOf.get(keys[i]) ?? 0;
    if (n >= rule.limit) blocked.add(rule.dim);
    if (rule.dim === "global" && n + 1 === Math.ceil(rule.limit / 2)) {
      console.warn(`[rate-limit] ${policy}: global usage at 50 % (${n + 1}/${rule.limit}); possible SMS pumping`);
    }
  });
  return [...blocked];
}

// Phone numbers are hashed so the limiter table holds no personal data (law 09-08).
const keyValue = (dim: Dimension, value: string) =>
  dim === "phone" ? createHash("sha256").update(value).digest("base64url") : value;

/**
 * Client IP from X-Forwarded-For, counted from the right past our own proxies (TRUSTED_PROXY_HOPS).
 * Without a configured proxy the header is client-controlled (Next only fills it when absent), so there is no IP.
 */
export function clientNet(headers: Headers): { ip?: string; subnet?: string } {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  const chain = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()) ?? [];
  const raw = hops > 0 ? chain[chain.length - hops] : undefined;
  if (!raw) return {};
  const ip = raw.replace(/^::ffff:(?=\d+\.)/i, ""); // IPv4-mapped IPv6 → IPv4
  if (isIPv4(ip)) return { ip, subnet: `${ip.split(".").slice(0, 3).join(".")}.0/24` };
  if (!isIPv6(ip)) return {};
  // One IPv6 client usually owns a whole /64, so both dimensions use it. Keys come from the expanded form:
  // "2001:db8::1" and "2001:0db8:0:0::1" must count as the same client.
  const prefix = `${expandIPv6(ip).slice(0, 4).join(":")}::/64`;
  return { ip: prefix, subnet: prefix };
}

// "2001:db8::1%eth0" → ["2001", "db8", "0", "0", "0", "0", "0", "1"] (lowercase, no leading zeros).
function expandIPv6(ip: string): string[] {
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.map((g) => parseInt(g, 16).toString(16));
}
