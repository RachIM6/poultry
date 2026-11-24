import { after } from "next/server";
import { isSameOriginRequest } from "@/lib/security/csrf";
import { readJson, tooLarge } from "@/lib/security/body";
import { consume } from "@/lib/security/rate-limit";
import { z } from "zod";
import { MAX_MUTATIONS_PER_PUSH } from "@/lib/sync/protocol";
import { push, scopeMatches } from "@/lib/sync/server";
import { postPending } from "@/modules/finance";
import { getTenantContext } from "@/modules/identity";
import { registry } from "../registry";

const MAX_BODY_BYTES = 2_000_000; // 500 mutations of a few KB

const PushBody = z.object({
  mutations: z
    .array(
      z.object({
        id: z.uuid(), // UUIDv7 from the device: the idempotency key
        type: z.string().max(64), // "<module>.<action>", e.g. "farm-registry.saveFarm"
        payload: z.unknown(),
        createdAt: z.iso.datetime({ offset: true }), // device clock, kept for the audit log only
      }),
    )
    .max(MAX_MUTATIONS_PER_PUSH),
});

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ ok: false, messageKey: "errors.FORBIDDEN" }, { status: 403 });
  // 401 sends the client to login; its outbox stays on the device (poultry-auth §0.5).
  const ctx = await getTenantContext(req.headers);
  if (!ctx.ok) return Response.json({ ok: false, messageKey: "errors.UNAUTHENTICATED" }, { status: 401 });
  if (!scopeMatches(req, ctx.value)) return Response.json({ ok: false, messageKey: "errors.SYNC_SCOPE" }, { status: 409 });
  if ((await consume("syncPush", { user: ctx.value.userId })).length > 0) {
    return Response.json({ ok: false, messageKey: "errors.TOO_MANY_REQUESTS" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const json = await readJson(req, MAX_BODY_BYTES);
  if (!json.ok) return tooLarge();
  const body = PushBody.safeParse(json.value);
  if (!body.success) return Response.json({ ok: false, messageKey: "errors.INVALID_INPUT" }, { status: 400 });

  const result = await push(ctx.value, body.data.mutations, registry);
  // SPEC-finance FN7: post what this push recorded, once the phone has its answer. A failure is caught up by the scheduler or the next read of the books (§9).
  after(() => postPending(ctx.value).catch((error) => console.error("[finance] posting failed", error)));
  return Response.json(result);
}
