"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { parseCentimes } from "@/lib/kernel/money";
import { payPlacement } from "@/modules/finance";
import { getTenantContext, limitSignedIn } from "@/modules/identity";

export type PayPlacementState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; finance still runs can() and Zod (poultry-auth §2).
export async function payPlacementAction(_: PayPlacementState, form: FormData): Promise<PayPlacementState> {
  const h = await headers();
  const ctx = await getTenantContext(h);
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  if (await limitSignedIn("authenticated", h, ctx.value.userId)) return { messageKey: "errors.TOO_MANY_REQUESTS" }; // rate-limiting.md §3 default
  const amount = parseCentimes(String(form.get("amount") ?? "").trim());
  if (amount === null) return { messageKey: "errors.INVALID_INPUT" };
  const treasuryId = form.get("treasuryId");
  const paid = await payPlacement(ctx.value, {
    id: form.get("id"),
    batchId: form.get("batchId"),
    day: form.get("day"),
    amountCentimes: String(amount),
    paidWith: form.get("paidWith"),
    treasuryId: typeof treasuryId === "string" && treasuryId ? treasuryId : null,
  });
  if (!paid.ok) return { messageKey: `errors.${paid.error}` };
  refresh();
  return { ok: true, messageKey: "Treasury.paid" };
}
