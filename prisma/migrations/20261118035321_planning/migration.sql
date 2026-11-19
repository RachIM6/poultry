-- CreateTable
CREATE TABLE "PlannedBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "placeOn" DATE NOT NULL,
    "chicks" INTEGER NOT NULL,
    "strainId" TEXT NOT NULL,
    "hatchery" TEXT NOT NULL,
    "chickPriceCentimes" BIGINT,
    "saleAge" INTEGER,
    "status" TEXT NOT NULL,
    "batchId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PlannedBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "minDays" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DowntimeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannedBatch_organizationId_idx" ON "PlannedBatch"("organizationId");

-- CreateIndex
CREATE INDEX "PlannedBatch_placeOn_status_idx" ON "PlannedBatch"("placeOn", "status");

-- CreateIndex
CREATE INDEX "DowntimeRule_organizationId_idx" ON "DowntimeRule"("organizationId");
