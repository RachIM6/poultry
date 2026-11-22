-- CreateTable
CREATE TABLE "FiscalYearClose" (
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "closedBy" UUID NOT NULL,
    "closedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FiscalYearClose_pkey" PRIMARY KEY ("legalEntityId","day")
);

-- CreateIndex
CREATE INDEX "FiscalYearClose_organizationId_idx" ON "FiscalYearClose"("organizationId");
