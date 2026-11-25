-- CreateTable
CREATE TABLE "EggCollection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "normal" INTEGER NOT NULL,
    "cracked" INTEGER NOT NULL,
    "dirty" INTEGER NOT NULL,
    "doubleYolk" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL,
    "broken" INTEGER NOT NULL,
    "sampleCount" INTEGER,
    "sampleGrams" INTEGER,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EggCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EggCollection_organizationId_batchId_day_idx" ON "EggCollection"("organizationId", "batchId", "day");

