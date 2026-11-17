-- CreateTable
CREATE TABLE "ClimateTargetSet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "bands" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClimateTargetSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClimateTargetSet_organizationId_idx" ON "ClimateTargetSet"("organizationId");
