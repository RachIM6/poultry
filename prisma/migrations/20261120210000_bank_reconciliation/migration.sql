-- CreateTable
CREATE TABLE "BankStatement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "treasuryId" UUID NOT NULL,
    "endDay" DATE NOT NULL,
    "closingCentimes" BIGINT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "journalLineId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "tickedBy" UUID NOT NULL,
    "tickedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("journalLineId")
);

-- CreateIndex
CREATE INDEX "BankStatement_organizationId_idx" ON "BankStatement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_treasuryId_endDay_key" ON "BankStatement"("treasuryId", "endDay");

-- CreateIndex
CREATE INDEX "BankMatch_statementId_idx" ON "BankMatch"("statementId");

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

