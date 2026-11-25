import { db } from "@/lib/db";

// member_export, member_delete: written by the operator tools (src/ops/member-data.ts), not here.
export type AuthAction = "code_requested" | "verify_failed" | "login" | "logout" | "rate_limited" | "captcha_failed" | "member_export" | "member_delete";

/** Who made the request, as far as the server can tell. Coarse on purpose (law 09-08). */
export type Client = { ip?: string; subnet?: string; userAgent?: string };

const USER_AGENT_MAX = 256;

/**
 * poultry-auth §6: one AuthEvent row. Never throws: a failed write is logged and login goes on, with the same answer.
 * Callers pass only the masked phone and no code, session id or captcha payload; the row keeps the subnet, not the IP.
 */
export async function recordAuthEvent(
  action: AuthAction,
  client: Client,
  event: { reason?: string; userId?: string; phone?: string } = {},
): Promise<void> {
  try {
    await db.authEvent.create({
      data: { action, ...event, ip: client.subnet, userAgent: client.userAgent?.slice(0, USER_AGENT_MAX) },
    });
  } catch (e) {
    // The error's code only: Prisma messages can echo the row.
    console.error(`[auth-event] ${action} not recorded: ${(e as { code?: string }).code ?? (e as Error).name}`);
  }
}
