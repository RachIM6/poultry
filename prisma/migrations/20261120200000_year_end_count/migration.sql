-- CreateTable
CREATE TABLE "YearEndCount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updatedBy" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "YearEndCount_quantity_check" CHECK ("quantity" >= 0),

    CONSTRAINT "YearEndCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YearEndCount_organizationId_idx" ON "YearEndCount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "YearEndCount_legalEntityId_day_subjectId_key" ON "YearEndCount"("legalEntityId", "day", "subjectId");

