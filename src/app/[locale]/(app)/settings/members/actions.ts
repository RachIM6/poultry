"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { Result } from "@/lib/kernel/result";
import type { TenantContext } from "@/lib/tenant";
import { cancelInvitation, changeRole, clientOf, getWriteContext, inviteMember, issueReset, removeMember } from "@/modules/identity";
import { forgetPushSubscriptions } from "@/modules/notifications";

// `code`: an invite or reset code, shown to the owner this once (ADR-015).
export type ActionState = { ok?: boolean; messageKey?: string; code?: string };

// Server actions get Next's Origin check; each still resolves the tenant and lets identity run can() + Zod (poultry-auth §2).
async function run(apply: (ctx: TenantContext, h: Headers) => Promise<Result<void | { code: string }>>): Promise<ActionState> {
  const h = await headers();
  const ctx = await getWriteContext(h);
  if (!ctx.ok) return { messageKey: `errors.${ctx.error}` };
  const result = await apply(ctx.value, h);
  if (!result.ok) return { messageKey: `errors.${result.error}` };
  refresh();
  return { ok: true, code: result.value?.code };
}

const fields = (form: FormData) => Object.fromEntries(form);

export const invite = async (_: ActionState, form: FormData) => run((ctx, h) => inviteMember(ctx, fields(form), clientOf(h)));
export const resetPassword = async (_: ActionState, form: FormData) => run((ctx, h) => issueReset(ctx, fields(form), clientOf(h)));
export const updateRole = async (_: ActionState, form: FormData) => run((ctx) => changeRole(ctx, fields(form)));
export const remove = async (_: ActionState, form: FormData) => run((ctx) => removeMember(ctx, fields(form), forgetPushSubscriptions));
export const cancel = async (_: ActionState, form: FormData) => run((ctx) => cancelInvitation(ctx, fields(form)));
