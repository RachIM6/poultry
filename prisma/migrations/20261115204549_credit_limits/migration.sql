-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "creditLimitCentimes" BIGINT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "creditApproval" TEXT;
