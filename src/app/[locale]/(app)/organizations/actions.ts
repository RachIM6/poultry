"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvitation, chooseOrganization, ORG_COOKIE, redeemInvite } from "@/modules/identity";

// SPEC-m5 PA2. Server actions get Next's Origin check; identity checks the membership, the invite code (ADR-015) or,
// with SMS login on, the invitation's verified phone.
// The cookie only says which farm to open: getTenantContext re-checks it on every request (ADR-013).
async function open(organizationId: string, form: FormData) {
  (await cookies()).set(ORG_COOKIE, organizationId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  redirect(`/${form.get("locale") === "ar" ? "ar" : "fr"}/dashboard`);
}

export async function openFarm(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  if ((await chooseOrganization(await headers(), organizationId)).ok) await open(organizationId, form);
}

/** ADR-015: joins with an invite code (onboarding, this screen), then opens that organisation. */
export async function joinWithCode(_: { messageKey?: string }, form: FormData): Promise<{ messageKey?: string }> {
  const joined = await redeemInvite(await headers(), form.get("code"));
  if (!joined.ok) return { messageKey: `errors.${joined.error}` };
  await open(joined.value, form); // redirects
  return {};
}

// SMS login only (AUTH_SMS_ENABLED): an invitation listed for the user's verified phone.
export async function acceptAndOpen(form: FormData) {
  const accepted = await acceptInvitation(await headers(), String(form.get("invitationId") ?? ""));
  if (accepted.ok) await open(accepted.value, form);
}
