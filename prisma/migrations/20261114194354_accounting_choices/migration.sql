-- CreateEnum
CREATE TYPE "Books" AS ENUM ('cash_book', 'ledger');

-- AlterTable
ALTER TABLE "LegalEntity" ADD COLUMN     "books" "Books",
ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pcaOverlay" BOOLEAN;
