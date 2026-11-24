import { isSameOriginRequest } from "@/lib/security/csrf";
import { readJson, tooLarge } from "@/lib/security/body";
import { getSession, saveLocale } from "@/modules/identity";

// SPEC I3: POST {"locale":"ar"|"fr"} saves the switcher's choice on the signed-in user (pushes, inbox).
// Needs a session, not a membership: a user still onboarding can switch too.
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const session = await getSession(req.headers);
  if (!session) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  const body = await readJson(req);
  if (!body.ok) return tooLarge();
  const saved = await saveLocale(session.userId, body.value);
  return saved.ok ? Response.json({ ok: true }) : Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });
}
