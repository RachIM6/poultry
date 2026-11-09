-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedOn" DATE,
ADD COLUMN     "costCentimes" BIGINT,
ADD COLUMN     "costPerKgCentimes" BIGINT,
ADD COLUMN     "soldGrams" INTEGER;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchId" UUID;

-- CreateTable
CREATE TABLE "BatchCost" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchCost_organizationId_batchId_idx" ON "BatchCost"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");
