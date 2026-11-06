-- CreateTable
CREATE TABLE "Weighing" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL,
    "totalGrams" INTEGER NOT NULL,
    "weightsGrams" INTEGER[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weighing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Weighing_batchId_day_idx" ON "Weighing"("batchId", "day");

-- CreateIndex
CREATE INDEX "Weighing_organizationId_idx" ON "Weighing"("organizationId");
