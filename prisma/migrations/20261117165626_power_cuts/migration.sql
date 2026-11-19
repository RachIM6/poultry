-- CreateTable
CREATE TABLE "PowerCut" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "endedAt" TIMESTAMPTZ,
    "generatorStarted" BOOLEAN,
    "generatorSeconds" INTEGER,
    "dieselMl" INTEGER,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerCut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PowerCut_organizationId_idx" ON "PowerCut"("organizationId");

-- CreateIndex
CREATE INDEX "PowerCut_farmId_endedAt_idx" ON "PowerCut"("farmId", "endedAt");
