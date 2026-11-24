import { consume } from "@/lib/security/rate-limit";
import { z } from "zod";
import { MAX_PULL_RECORDS } from "@/lib/sync/protocol";
import { pull, scopeMatches } from "@/lib/sync/server";
import { getTenantContext } from "@/modules/identity";
import { registry } from "../registry";

// ADR-014: `snapshot=1` from a phone that replaces its copy (no deleted records from 0); `records`, "<entity>:<id>,..."
// of refused writes, to read back from the server.
const RecordKey = z.string().transform((key) => key.split(":")).pipe(z.tuple([z.string().regex(/^[A-Za-z]+$/), z.guid()]));
const PullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  snapshot: z.literal("1").optional(),
  records: z.string().transform((s) => s.split(",")).pipe(z.array(RecordKey).min(1).max(MAX_PULL_RECORDS)).optional(),
});

// A read: no CSRF check. The session cookie is SameSite=Lax and the JSON is not readable cross-origin.
export async function GET(req: Request) {
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if (!scopeMatches(req, ctx.value)) return Response.json({ ok: false, messageKey: "errors.SYNC_SCOPE" }, { status: 409 });
  if ((await consume("syncPull", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const query = PullQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });
  const { since, snapshot, records } = query.data;
  const page = await pull(ctx.value, since, registry, { snapshot: !!snapshot, records: records?.map(([entity, id]) => ({ entity, id })) });
  return Response.json(page, { headers: { "Cache-Control": "no-store" } });
}
