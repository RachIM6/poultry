-- CreateTable
CREATE TABLE "Budget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "basedOn" UUID,
    "chicks" INTEGER NOT NULL,
    "chickPriceCentimes" BIGINT NOT NULL,
    "feedGrams" BIGINT NOT NULL,
    "feedPricePerKgCentimes" BIGINT NOT NULL,
    "otherCostCentimes" BIGINT NOT NULL,
    "plannedGrams" BIGINT NOT NULL,
    "salePricePerKgCentimes" BIGINT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");
