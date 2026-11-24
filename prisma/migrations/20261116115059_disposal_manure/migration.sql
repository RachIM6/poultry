-- CreateTable
CREATE TABLE "Disposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "batchId" UUID,
    "birds" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "method" TEXT NOT NULL,
    "methodNote" TEXT,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManureRemoval" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "houseId" UUID,
    "batchId" UUID,
    "quantityKg" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "recipient" TEXT,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManureRemoval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Disposal_organizationId_farmId_day_idx" ON "Disposal"("organizationId", "farmId", "day");

-- CreateIndex
CREATE INDEX "ManureRemoval_organizationId_farmId_day_idx" ON "ManureRemoval"("organizationId", "farmId", "day");
