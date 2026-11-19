import { db } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { addOwner, lockForOnboarding } from "@/modules/identity";
import { accountingProfileOf, type AccountingProfile, type LegalForm, type OnboardingInput } from "@/modules/farm-registry/schema";

export type LegalEntityDto = { id: string; name: string; form: LegalForm; accountingProfile: AccountingProfile };

/** SPEC F1: first login → the organisation, its legal entity and the owner membership, in one transaction. */
export async function createOrganization(userId: string, input: OnboardingInput): Promise<Result<TenantContext, "ALREADY_ONBOARDED">> {
  return db.$transaction(async (tx) => {
    if (!(await lockForOnboarding(tx, userId))) return fail("ALREADY_ONBOARDED");
    const org = await tx.organization.create({ data: { name: input.name } });
    const entity = await tx.legalEntity.create({ data: { organizationId: org.id, name: input.name, form: input.form } });
    await addOwner(tx, { organizationId: org.id, userId, locale: input.locale });
    await tx.auditEvent.createMany({
      data: [
        { organizationId: org.id, userId, entity: "Organization", entityId: org.id, action: "create", after: { name: org.name } },
        { organizationId: org.id, userId, entity: "LegalEntity", entityId: entity.id, action: "create", after: { name: entity.name, form: entity.form } },
      ],
    });
    return ok({ userId, organizationId: org.id, role: "owner" as const });
  });
}

/** Null when the entity belongs to another organisation: callers answer 404, never 403 (ADR-006). */
export async function getLegalEntity(ctx: TenantContext, id: string): Promise<LegalEntityDto | null> {
  if (!can(ctx, "organization.read")) return null;
  const row = await db.legalEntity.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row && toDto(row);
}

export async function listLegalEntities(ctx: TenantContext): Promise<LegalEntityDto[]> {
  if (!can(ctx, "organization.read")) return [];
  const rows = await db.legalEntity.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

const toDto = (row: { id: string; name: string; form: LegalForm }): LegalEntityDto => ({
  id: row.id,
  name: row.name,
  form: row.form,
  accountingProfile: accountingProfileOf(row.form),
});
