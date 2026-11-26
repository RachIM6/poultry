"use server";

import { cookies, headers } from "next/headers";
import { acceptInvitation, chooseOrganization, ORG_COOKIE, redeemInvite, saveName } from "@/modules/identity";

// SPEC-m5 PA2. Server actions get Next's Origin check; identity checks the membership, the invite code (ADR-015) or,
// with SMS login on, the invitation's verified phone.
// The cookie only says which farm to open: getTenantContext re-checks it on every request (ADR-013). No redirect here:
// the form remembers the new scope on the phone first, then opens the dashboard (src/components/join-code-form.tsx).
async function open(organizationId: string) {
  (await cookies()).set(ORG_COOKIE, organizationId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
}

export async function openFarm(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  if (!(await chooseOrganization(await headers(), organizationId)).ok) return false;
  await open(organizationId);
  return true;
}

/** ADR-015: joins with an invite code (onboarding, this screen), then opens that organisation. */
export async function joinWithCode(_: { messageKey?: string }, form: FormData): Promise<{ messageKey?: string; opened?: true }> {
  const joined = await redeemInvite(await headers(), form.get("code"));
  if (!joined.ok) return { messageKey: `errors.${joined.error}` };
  await open(joined.value);
  return { opened: true };
}

// SMS login only (AUTH_SMS_ENABLED): an invitation listed for the user's verified phone.
export async function acceptAndOpen(form: FormData) {
  const accepted = await acceptInvitation(await headers(), String(form.get("invitationId") ?? ""));
  if (!accepted.ok) return false;
  await open(accepted.value);
  return true;
}

/** « Votre nom »: the user's own first and last name. */
export async function saveMyName(form: FormData): Promise<{ messageKey: string; saved?: true }> {
  const saved = await saveName(await headers(), { firstName: form.get("firstName"), lastName: form.get("lastName") });
  return saved.ok ? { messageKey: "Header.nameSaved", saved: true } : { messageKey: `errors.${saved.error}` };
}
