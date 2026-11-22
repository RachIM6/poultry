-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "farmId" UUID,
    "houseId" UUID,
    "acquiredOn" DATE NOT NULL,
    "inServiceOn" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "vatCentimes" BIGINT NOT NULL DEFAULT 0,
    "costCentimes" BIGINT NOT NULL,
    "residualCentimes" BIGINT NOT NULL DEFAULT 0,
    "lifeMonths" INTEGER,
    "paidWith" TEXT,
    "openingOn" DATE,
    "openingAccumulatedCentimes" BIGINT NOT NULL DEFAULT 0,
    "disposedOn" DATE,
    "disposalPriceCentimes" BIGINT,
    "receiptFileId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedAsset_organizationId_idx" ON "FixedAsset"("organizationId");
