import { audit } from "@/lib/audit";
import { areVaccines } from "@/modules/reference-data/service";
import { fail, ok } from "@/lib/kernel/result";
import { defineMutation, recordChange, type SyncRegistry } from "@/lib/sync/server";
import {
  CopyProtocol,
  REFERENCE_MUTATIONS,
  UpdateProtocol,
  type ProtocolDto,
  type ProtocolItem,
} from "@/modules/reference-data/schema";

// R2: an organisation copies a protocol template and edits its copy offline. Templates have no mutation: read-only.

type Row = { id: string; templateId: string | null; name: string; items: unknown };
const dto = (r: Row): ProtocolDto => ({ id: r.id, templateId: r.templateId, name: r.name, items: r.items as ProtocolItem[] });


export const referenceDataSync: SyncRegistry = {
  mutations: {
    [REFERENCE_MUTATIONS.copyProtocol]: defineMutation({
      schema: CopyProtocol,
      action: "protocols.manage",
      async apply(tx, ctx, { id, templateId, name }, meta) {
        const template = await tx.protocolTemplate.findUnique({ where: { id: templateId } });
        if (!template) return fail("NOT_FOUND");
        if (await tx.vaccinationProtocol.findUnique({ where: { id }, select: { id: true } })) return fail("ALREADY_EXISTS");
        const row = await tx.vaccinationProtocol.create({
          data: { id, organizationId: ctx.organizationId, templateId, name, items: template.items ?? [] },
        });
        await recordChange(tx, ctx, "protocol", id, dto(row));
        await audit(tx, ctx, { entity: "VaccinationProtocol", entityId: id, action: "create", after: dto(row), ...meta });
        return ok(undefined);
      },
    }),
    // Last write received wins per field; items are one field (the whole schedule), like ADR-003 §5.
    [REFERENCE_MUTATIONS.updateProtocol]: defineMutation({
      schema: UpdateProtocol,
      action: "protocols.manage",
      async apply(tx, ctx, { id, changes }, meta) {
        const row = await tx.vaccinationProtocol.findFirst({ where: { id, organizationId: ctx.organizationId } });
        if (!row) return fail("NOT_FOUND");
        if (changes.items && !(await areVaccines(tx, changes.items.map((i) => i.productId)))) return fail("INVALID_INPUT");
        const updated = await tx.vaccinationProtocol.update({ where: { id }, data: changes });
        await recordChange(tx, ctx, "protocol", id, dto(updated));
        const before = Object.fromEntries(Object.keys(changes).map((k) => [k, dto(row)[k as keyof ProtocolDto]]));
        await audit(tx, ctx, { entity: "VaccinationProtocol", entityId: id, action: "update", before, after: changes, ...meta });
        return ok(undefined);
      },
    }),
  },
  entities: { protocol: (_ctx, data: ProtocolDto) => data }, // no money in a protocol
};
