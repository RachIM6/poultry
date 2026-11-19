-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "batchId" UUID,
ADD COLUMN     "serviceFrom" DATE,
ADD COLUMN     "serviceTo" DATE,
ADD COLUMN     "shared" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FrozenAllocation" (
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "amountCentimes" BIGINT NOT NULL,

    CONSTRAINT "FrozenAllocation_pkey" PRIMARY KEY ("batchId","expenseId")
);

-- CreateTable
CREATE TABLE "FrozenBatch" (
    "batchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "frozenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrozenBatch_pkey" PRIMARY KEY ("batchId")
);

-- CreateIndex
CREATE INDEX "FrozenAllocation_organizationId_expenseId_idx" ON "FrozenAllocation"("organizationId", "expenseId");

-- CreateIndex
CREATE INDEX "FrozenBatch_organizationId_idx" ON "FrozenBatch"("organizationId");
