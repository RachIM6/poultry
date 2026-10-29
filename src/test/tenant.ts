import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";
import { createOrganization } from "@/modules/farm-registry";

/**
 * Isolation-test pattern (ADR-006): an onboarded owner per organisation, through the real onboarding.
 * Create records as `a`, read them as `b`, and expect nothing back: `const [a, b] = await twoTenants()`.
 */
export async function tenant(phone: string, name = `Ferme ${phone}`): Promise<TenantContext> {
  const user = await db.user.create({ data: { phoneNumber: phone, name: phone, email: `${phone.slice(1)}@phone.invalid` } });
  const ctx = await createOrganization(user.id, { name, form: "individual", locale: "fr" });
  if (!ctx.ok) throw new Error(ctx.error);
  return ctx.value;
}

export const twoTenants = () => Promise.all([tenant("+212600000001", "Ferme A"), tenant("+212600000002", "Ferme B")]);
