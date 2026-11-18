"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvitation, chooseOrganization, ORG_COOKIE } from "@/modules/identity";

// SPEC-m5 PA2. Server actions get Next's Origin check; identity checks the membership or the invitation's phone.
// The cookie only says which farm to open: getTenantContext re-checks it on every request (ADR-011).
async function open(organizationId: string, form: FormData) {
  (await cookies()).set(ORG_COOKIE, organizationId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  redirect(`/${form.get("locale") === "ar" ? "ar" : "fr"}/dashboard`);
}

export async function openFarm(form: FormData) {
  const organizationId = String(form.get("organizationId") ?? "");
  if ((await chooseOrganization(await headers(), organizationId)).ok) await open(organizationId, form);
}

export async function acceptAndOpen(form: FormData) {
  const accepted = await acceptInvitation(await headers(), String(form.get("invitationId") ?? ""));
  if (accepted.ok) await open(accepted.value, form);
}
