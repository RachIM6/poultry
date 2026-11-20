-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "instrumentDueOn" DATE,
ADD COLUMN     "instrumentNumber" TEXT;

-- CreateTable
CREATE TABLE "IssuedDebit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedDebit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuedDebit_instrumentId_key" ON "IssuedDebit"("instrumentId");

-- CreateIndex
CREATE INDEX "IssuedDebit_organizationId_idx" ON "IssuedDebit"("organizationId");
