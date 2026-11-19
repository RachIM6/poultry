-- CreateTable
CREATE TABLE "Treatment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dose" TEXT NOT NULL,
    "startOn" DATE NOT NULL,
    "endOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "prescriber" TEXT NOT NULL,
    "withdrawalDays" INTEGER NOT NULL,
    "withdrawalEndsOn" DATE NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Treatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VetVisit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "on" DATE NOT NULL,
    "vetName" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VetVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Treatment_organizationId_batchId_idx" ON "Treatment"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "VetVisit_organizationId_batchId_idx" ON "VetVisit"("organizationId", "batchId");
