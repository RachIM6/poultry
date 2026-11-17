-- CreateTable
CREATE TABLE "LabourRules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "smagDailyCentimes" BIGINT,
    "employeeCappedBp" INTEGER,
    "employeeUncappedBp" INTEGER,
    "employerCappedBp" INTEGER,
    "employerUncappedBp" INTEGER,
    "monthlyCapCentimes" BIGINT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayMonth" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "rulesId" UUID,
    "validatedOn" DATE NOT NULL,
    "validatedBy" UUID NOT NULL,

    CONSTRAINT "PayMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabourRules_organizationId_idx" ON "LabourRules"("organizationId");

-- CreateIndex
CREATE INDEX "PayMonth_organizationId_idx" ON "PayMonth"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayMonth_farmId_month_key" ON "PayMonth"("farmId", "month");
