-- CreateTable
CREATE TABLE "YearEndValue" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "valueCentimes" BIGINT NOT NULL,
    "updatedBy" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "YearEndValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YearEndValue_organizationId_idx" ON "YearEndValue"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "YearEndValue_legalEntityId_day_subjectId_key" ON "YearEndValue"("legalEntityId", "day", "subjectId");
