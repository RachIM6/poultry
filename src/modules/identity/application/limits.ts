import { consume } from "@/lib/security/rate-limit";
import { POLICIES, type PolicyName } from "@/lib/security/policies";
import { clientOf } from "@/modules/identity/application/login";
import { recordAuthEvent } from "@/modules/identity/infrastructure/auth-events";
import { sessionKey } from "@/modules/identity/infrastructure/better-auth";

/**
 * poultry-auth rate-limiting.md §3, §7 for a signed-in request: counts it on its session and its user, and audits a
 * block. Returns the Retry-After seconds (the longest window that blocks), or null when the request may go on.
 */
export async function limitSignedIn(policy: PolicyName, headers: Headers, userId: string): Promise<number | null> {
  const blocked = await consume(policy, { user: userId, session: await sessionKey(headers) });
  if (blocked.length === 0) return null;
  await recordAuthEvent("rate_limited", clientOf(headers), { userId, reason: `${policy}:${blocked.join(",")}` });
  return Math.max(...POLICIES[policy].filter((rule) => blocked.includes(rule.dim)).map((rule) => rule.windowSec));
}
