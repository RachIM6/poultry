-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "takenBy" TEXT,
ALTER COLUMN "buyerId" DROP NOT NULL;
