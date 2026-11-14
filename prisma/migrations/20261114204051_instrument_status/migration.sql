-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "creditBlocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "InstrumentStatus" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstrumentStatus_organizationId_idx" ON "InstrumentStatus"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentStatus_instrumentId_state_key" ON "InstrumentStatus"("instrumentId", "state");
