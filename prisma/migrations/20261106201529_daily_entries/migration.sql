-- CreateTable
CREATE TABLE "DailyEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "dead" INTEGER NOT NULL DEFAULT 0,
    "deathCause" TEXT,
    "culled" INTEGER NOT NULL DEFAULT 0,
    "feedStockItemId" UUID,
    "feedGrams" INTEGER,
    "waterMl" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyEntry_organizationId_idx" ON "DailyEntry"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEntry_batchId_day_key" ON "DailyEntry"("batchId", "day");
