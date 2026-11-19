import { isSameOriginRequest } from "@/lib/security/csrf";
import { logout } from "@/modules/identity";

// TODO(T9): refuse while the outbox has unsynced changes unless the user confirms (poultry-auth §3).
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  return Response.json({ ok: true }, { headers: await logout(req.headers) });
}
