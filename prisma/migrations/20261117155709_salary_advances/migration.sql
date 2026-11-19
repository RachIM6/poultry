-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "deductMonth" TEXT NOT NULL,
    "note" TEXT,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryAdvance_organizationId_idx" ON "SalaryAdvance"("organizationId");
