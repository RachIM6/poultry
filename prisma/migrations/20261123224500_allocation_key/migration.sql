-- SPEC-finance FN14: the entity's key for splitting shared costs across batches (bird-days by default).

-- CreateEnum
CREATE TYPE "AllocationKey" AS ENUM ('birdDays', 'houseArea', 'kgSold');

-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN "allocationKey" "AllocationKey" NOT NULL DEFAULT 'birdDays';
