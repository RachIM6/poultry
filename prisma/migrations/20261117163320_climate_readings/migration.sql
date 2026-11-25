-- CreateTable
CREATE TABLE "ClimateReading" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "temperatureTenths" INTEGER NOT NULL,
    "humidity" INTEGER NOT NULL,
    "ammonia" INTEGER,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClimateReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClimateReading_organizationId_idx" ON "ClimateReading"("organizationId");

-- CreateIndex
CREATE INDEX "ClimateReading_houseId_day_idx" ON "ClimateReading"("houseId", "day");
