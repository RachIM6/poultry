-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "treasuryId" UUID;

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "paidFrom" TEXT NOT NULL,
    "treasuryId" UUID,
    "note" TEXT,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "fromId" UUID NOT NULL,
    "toId" UUID NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreasuryAccount_organizationId_idx" ON "TreasuryAccount"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_day_idx" ON "Expense"("organizationId", "day");

-- CreateIndex
CREATE INDEX "TreasuryTransfer_organizationId_idx" ON "TreasuryTransfer"("organizationId");
