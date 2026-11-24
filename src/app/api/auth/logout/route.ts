import { readJson, tooLarge } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { logout, logoutEverywhere } from "@/modules/identity";
import { forgetPushSubscription, forgetPushSubscriptions } from "@/modules/notifications";

// Unsynced changes: the button asks before calling this, and the outbox stays on the phone (poultry-auth §3).
// `?everywhere`: every device of this user is logged out, this one too (a lost phone).
// The body may carry this browser's push `endpoint`: the server forgets it, so a failed unsubscribe on the phone
// doesn't leave a shared phone receiving this user's pushes.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const body = await readJson(req);
  if (!body.ok) return tooLarge();
  const everywhere = new URL(req.url).searchParams.has("everywhere");
  const headers = await (everywhere
    ? logoutEverywhere(req.headers, forgetPushSubscriptions)
    : logout(req.headers, (userId) => forgetPushSubscription(userId, body.value)));
  return Response.json({ ok: true }, { headers });
}
