import { db, type Tx } from "@/lib/db";
import { fail, ok, type Result } from "@/lib/kernel/result";
import { can } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant";
import { addOwner, lockForOnboarding } from "@/modules/identity";
import { accountingProfileOf, type AccountingChoices, type AccountingProfile, type Books, type LegalForm, type OnboardingInput } from "@/modules/farm-registry/schema";

/** `fiscalYearStartMonth`: 1–12, the month the fiscal year starts (ADR-010 §1, default January). */
export type LegalEntityDto = { id: string; name: string; form: LegalForm; accountingProfile: AccountingProfile; fiscalYearStartMonth: number };

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

/**
 * For finance (ADR-010), inside its transaction: the entity with its accounting profile, row-locked so that a profile
 * change and the year's first entry run one after the other. Null when it belongs to another organisation.
 */
export async function legalEntityIn(tx: Tx, ctx: TenantContext, id: string): Promise<LegalEntityDto | null> {
  await tx.$executeRaw`SELECT 1 FROM "LegalEntity" WHERE id = ${id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`;
  const row = await tx.legalEntity.findFirst({ where: { id, organizationId: ctx.organizationId } });
  return row && toDto(row);
}

/** ADR-010: the owner's accounting choices. Finance calls this after checking that the fiscal year has no entry. */
export async function saveAccountingChoices(tx: Tx, ctx: TenantContext, id: string, choices: AccountingChoices & { fiscalYearStartMonth: number }) {
  const before = await tx.legalEntity.findFirstOrThrow({ where: { id, organizationId: ctx.organizationId }, select: { books: true, pcaOverlay: true, fiscalYearStartMonth: true } });
  await tx.legalEntity.update({ where: { id }, data: choices });
  await tx.auditEvent.create({
    data: { organizationId: ctx.organizationId, userId: ctx.userId, entity: "LegalEntity", entityId: id, action: "update", before, after: choices },
  });
}

type Row = { id: string; name: string; form: LegalForm; books: Books | null; pcaOverlay: boolean | null; fiscalYearStartMonth: number };

const toDto = (row: Row): LegalEntityDto => ({
  id: row.id,
  name: row.name,
  form: row.form,
  accountingProfile: accountingProfileOf(row.form, { books: row.books, pcaOverlay: row.pcaOverlay }),
  fiscalYearStartMonth: row.fiscalYearStartMonth,
});
