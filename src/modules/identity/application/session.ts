import { db } from "@/lib/db";
import { systemClock, type Clock } from "@/lib/kernel/clock";
import { auth, AUTH_CONFIG } from "@/modules/identity/infrastructure/better-auth";

// On its own so login (which audits a partner's sign-in through membership) and membership both read it, without a cycle.
/** The signed-in user, or null. Enforces the 90-day absolute cap on top of Better Auth's 30-day sliding expiry. */
export async function getSession(headers: Headers, clock: Clock = systemClock) {
  const current = await auth.api.getSession({ headers });
  if (!current) return null;
  const ageSec = (clock.now().getTime() - current.session.createdAt.getTime()) / 1000;
  if (ageSec > AUTH_CONFIG.session.absoluteMaxSec) {
    await db.session.deleteMany({ where: { id: current.session.id } });
    return null;
  }
  return { userId: current.user.id, phone: current.user.phoneNumber, locale: current.user.locale };
}
