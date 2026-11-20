-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "freeChicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "litterTempTenths" INTEGER,
ADD COLUMN     "parentFlock" TEXT,
ADD COLUMN     "weakChicks" INTEGER;

-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "doaClaimThresholdPermille" INTEGER;

