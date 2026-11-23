-- AlterTable
ALTER TABLE "Buyer" ADD COLUMN     "address" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "destinationAddress" TEXT,
ADD COLUMN     "destinationName" TEXT;

