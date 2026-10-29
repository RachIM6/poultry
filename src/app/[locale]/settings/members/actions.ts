"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import type { Result } from "@/lib/kernel/result";
import type { TenantContext } from "@/lib/tenant";
import { cancelInvitation, changeRole, getTenantContext, inviteMember, removeMember } from "@/modules/identity";

export type ActionState = { ok?: boolean; messageKey?: string };

// Server actions get Next's Origin check; each still resolves the tenant and lets identity run can() + Zod (poultry-auth §2).
async function run(apply: (ctx: TenantContext) => Promise<Result<void>>): Promise<ActionState> {
  const ctx = await getTenantContext(await headers());
  if (!ctx.ok) return { messageKey: "errors.UNAUTHENTICATED" };
  const result = await apply(ctx.value);
  if (!result.ok) return { messageKey: `errors.${result.error}` };
  refresh();
  return { ok: true };
}

const fields = (form: FormData) => Object.fromEntries(form);

export const invite = async (_: ActionState, form: FormData) => run((ctx) => inviteMember(ctx, fields(form)));
export const updateRole = async (_: ActionState, form: FormData) => run((ctx) => changeRole(ctx, fields(form)));
export const remove = async (_: ActionState, form: FormData) => run((ctx) => removeMember(ctx, fields(form)));
export const cancel = async (_: ActionState, form: FormData) => run((ctx) => cancelInvitation(ctx, fields(form)));
