import { isSameOriginRequest } from "@/lib/security/csrf";
import { logout, logoutEverywhere } from "@/modules/identity";

// Unsynced changes: the button asks before calling this, and the outbox stays on the phone (poultry-auth §3).
// `?everywhere`: every device of this user is logged out, this one too (a lost phone).
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const everywhere = new URL(req.url).searchParams.has("everywhere");
  return Response.json({ ok: true }, { headers: await (everywhere ? logoutEverywhere : logout)(req.headers) });
}
