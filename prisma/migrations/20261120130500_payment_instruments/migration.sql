-- AlterTable
ALTER TABLE "BuyerPayment" ADD COLUMN     "instrumentDueOn" DATE,
ADD COLUMN     "instrumentNumber" TEXT,
ADD COLUMN     "instrumentRemindedAt" TIMESTAMPTZ;
