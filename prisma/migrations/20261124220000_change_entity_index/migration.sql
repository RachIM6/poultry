-- SPEC-finance FN7, §9 "Postings catch up": each posting source reads one entity's changes past its cursor, and the
-- scheduler and the reads of the books check every source for pending changes; without this index each read scans
-- the organisation's whole change log from the cursor.
CREATE INDEX "Change_organizationId_entity_version_idx" ON "Change"("organizationId", "entity", "version");
