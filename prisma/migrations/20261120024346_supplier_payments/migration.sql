-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_supplierId_idx" ON "SupplierPayment"("organizationId", "supplierId");
