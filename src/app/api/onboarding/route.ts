import { isSameOriginRequest } from "@/lib/security/csrf";
import { createOrganization, parseOnboarding } from "@/modules/farm-registry";
import { getSession } from "@/modules/identity";

// No rate limit: it needs a session, and creates at most one organisation per user (lockForOnboarding).
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  const session = await getSession(req.headers);
  if (!session) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });

  const input = parseOnboarding(await req.json().catch(() => null));
  if (!input.ok) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });

  const result = await createOrganization(session.userId, input.value);
  return result.ok
    ? Response.json({ ok: true }, { status: 201 })
    : Response.json({ ok: false, messageKey: "errors.ALREADY_ONBOARDED" }, { status: 409 });
}
