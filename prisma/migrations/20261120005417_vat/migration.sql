-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "vatCentimes" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "vatCentimes" BIGINT NOT NULL DEFAULT 0;
