-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "species" TEXT NOT NULL DEFAULT 'broiler',
    "strainId" TEXT NOT NULL,
    "placedOn" DATE NOT NULL,
    "chicksPlaced" INTEGER NOT NULL,
    "deadOnArrival" INTEGER NOT NULL,
    "hatchery" TEXT NOT NULL,
    "deliveryNote" TEXT NOT NULL,
    "chickUnitPriceCentimes" BIGINT NOT NULL,
    "dayOldWeightGrams" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_organizationId_idx" ON "Batch"("organizationId");

-- CreateIndex
CREATE INDEX "Batch_houseId_idx" ON "Batch"("houseId");

-- SPEC B1: one open batch per house, whatever the order two devices sync in.
CREATE UNIQUE INDEX "Batch_one_open_per_house" ON "Batch"("houseId") WHERE status = 'open';
