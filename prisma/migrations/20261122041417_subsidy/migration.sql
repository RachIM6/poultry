-- CreateTable
CREATE TABLE "Subsidy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "grantor" TEXT NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "treasuryId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subsidy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubsidyAsset" (
    "subsidyId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,

    CONSTRAINT "SubsidyAsset_pkey" PRIMARY KEY ("subsidyId","assetId")
);

-- CreateIndex
CREATE INDEX "Subsidy_organizationId_idx" ON "Subsidy"("organizationId");

-- CreateIndex
CREATE INDEX "SubsidyAsset_organizationId_idx" ON "SubsidyAsset"("organizationId");

-- CreateIndex
CREATE INDEX "SubsidyAsset_assetId_idx" ON "SubsidyAsset"("assetId");

-- AddForeignKey
ALTER TABLE "SubsidyAsset" ADD CONSTRAINT "SubsidyAsset_subsidyId_fkey" FOREIGN KEY ("subsidyId") REFERENCES "Subsidy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubsidyAsset" ADD CONSTRAINT "SubsidyAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
