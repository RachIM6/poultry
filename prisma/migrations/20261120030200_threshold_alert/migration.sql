-- CreateTable
CREATE TABLE "ThresholdAlert" (
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "fiscalYearFrom" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThresholdAlert_pkey" PRIMARY KEY ("legalEntityId","fiscalYearFrom")
);
