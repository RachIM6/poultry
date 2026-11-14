-- CreateEnum
CREATE TYPE "Journal" AS ENUM ('AC', 'VT', 'CA', 'BQ', 'EF', 'OD');

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "journal" "Journal" NOT NULL,
    "day" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "sourceModule" TEXT,
    "sourceId" TEXT,
    "sourceVersion" INTEGER,
    "reversesId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "debitCentimes" BIGINT NOT NULL DEFAULT 0,
    "creditCentimes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockedPeriod" (
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "lockedBy" UUID NOT NULL,
    "lockedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockedPeriod_pkey" PRIMARY KEY ("legalEntityId","month")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_legalEntityId_day_idx" ON "JournalEntry"("organizationId", "legalEntityId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sourceModule_sourceId_sourceVersion_key" ON "JournalEntry"("sourceModule", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_account_idx" ON "JournalLine"("organizationId", "account");

-- CreateIndex
CREATE INDEX "LockedPeriod_organizationId_idx" ON "LockedPeriod"("organizationId");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SPEC-finance FN4: one side per line, never negative (the domain checks it too).
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side" CHECK (
  "debitCentimes" >= 0 AND "creditCentimes" >= 0 AND ("debitCentimes" > 0) <> ("creditCentimes" > 0)
);

-- FN4: at commit, every entry touched has at least two lines and Σdebit = Σcredit. Deferred, because the lines of an
-- entry are inserted one by one inside the transaction; a row-level CHECK can't see the other lines.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  entry uuid := CASE WHEN TG_TABLE_NAME = 'JournalEntry' THEN NEW.id ELSE NEW."entryId" END;
  n int;
  balance numeric;
BEGIN
  SELECT count(*), coalesce(sum("debitCentimes" - "creditCentimes"), 0) INTO n, balance FROM "JournalLine" WHERE "entryId" = entry;
  IF n < 2 OR balance <> 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (% lines, balance %)', entry, n, balance USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalEntry_balanced" AFTER INSERT ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
CREATE CONSTRAINT TRIGGER "JournalLine_balanced" AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- FN5: posted entries are never updated or deleted; a correction is a reversal plus a new entry.
-- (TRUNCATE, used to reset the test database, doesn't fire row triggers.)
CREATE FUNCTION journal_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'posted journal entries are immutable: post a reversal' USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_immutable" BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION journal_immutable();
CREATE TRIGGER "JournalLine_immutable" BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION journal_immutable();
