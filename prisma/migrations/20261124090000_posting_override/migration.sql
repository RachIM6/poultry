-- SPEC-finance FN8: the owner's per-entity override of a default posting rule's account, append-only (the history
-- tells which override was in force when a source was first posted).

-- CreateTable
CREATE TABLE "PostingOverride" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "ruleAccount" TEXT NOT NULL,
    "account" TEXT,
    "savedBy" UUID NOT NULL,
    "savedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingOverride_organizationId_idx" ON "PostingOverride"("organizationId");

-- CreateIndex
CREATE INDEX "PostingOverride_legalEntityId_savedAt_idx" ON "PostingOverride"("legalEntityId", "savedAt");

-- A change is a new row, never an edit. (TRUNCATE, used to reset the test database, doesn't fire row triggers.)
CREATE FUNCTION posting_override_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'posting overrides are append-only: save a new one' USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "PostingOverride_append_only" BEFORE UPDATE OR DELETE ON "PostingOverride" FOR EACH ROW EXECUTE FUNCTION posting_override_append_only();
