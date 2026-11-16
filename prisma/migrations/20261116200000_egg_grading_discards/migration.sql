-- CreateTable
CREATE TABLE "EggGrading" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "laidOn" DATE NOT NULL,
    "grades" JSONB NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EggGrading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EggDiscard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "laidOn" DATE NOT NULL,
    "item" TEXT NOT NULL,
    "eggs" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EggDiscard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EggGrading_organizationId_batchId_idx" ON "EggGrading"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "EggDiscard_organizationId_batchId_idx" ON "EggDiscard"("organizationId", "batchId");

