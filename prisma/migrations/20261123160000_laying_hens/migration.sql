-- SPEC-finance FC6 (T114, T115): the method for laying hens and their pullets (classic by default, FQ7a), and the
-- owner's depreciation figures of each laying flock under the classic method.

-- CreateEnum
CREATE TYPE "HensMethod" AS ENUM ('classic', 'simplified');

-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN "hensMethod" "HensMethod" NOT NULL DEFAULT 'classic';

-- CreateTable
CREATE TABLE "HensSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "lifeMonths" INTEGER NOT NULL,
    "cullValueCentimes" BIGINT NOT NULL,
    "updatedBy" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "HensSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HensSchedule_organizationId_idx" ON "HensSchedule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HensSchedule_legalEntityId_batchId_key" ON "HensSchedule"("legalEntityId", "batchId");
