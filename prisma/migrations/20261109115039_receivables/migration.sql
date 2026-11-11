-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "instrumentRemindedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "BuyerPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerPayment_organizationId_buyerId_idx" ON "BuyerPayment"("organizationId", "buyerId");
