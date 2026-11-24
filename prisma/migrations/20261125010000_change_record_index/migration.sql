-- ADR-014: the compacted pull sends a change only when no later change of the same record exists. Without this index
-- that check scans every later change of the entity, once per row sent.
CREATE INDEX "Change_organizationId_entity_entityId_version_idx" ON "Change"("organizationId", "entity", "entityId", "version");
