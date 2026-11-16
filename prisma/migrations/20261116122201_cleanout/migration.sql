-- CreateTable
CREATE TABLE "Cleanout" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "afterBatchId" UUID NOT NULL,
    "startedOn" DATE NOT NULL,
    "startedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cleanout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanoutStep" (
    "id" UUID NOT NULL,
    "cleanoutId" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "product" TEXT,
    "dose" TEXT,
    "productLot" TEXT,
    "note" TEXT,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanoutStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DowntimeSetting" (
    "farmId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "minDays" INTEGER,

    CONSTRAINT "DowntimeSetting_pkey" PRIMARY KEY ("farmId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cleanout_afterBatchId_key" ON "Cleanout"("afterBatchId");

-- CreateIndex
CREATE INDEX "Cleanout_organizationId_houseId_idx" ON "Cleanout"("organizationId", "houseId");

-- CreateIndex
CREATE UNIQUE INDEX "CleanoutStep_cleanoutId_step_key" ON "CleanoutStep"("cleanoutId", "step");

-- AddForeignKey
ALTER TABLE "CleanoutStep" ADD CONSTRAINT "CleanoutStep_cleanoutId_fkey" FOREIGN KEY ("cleanoutId") REFERENCES "Cleanout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
