-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "eggWithdrawalDays" INTEGER;

-- AlterTable
ALTER TABLE "ProtocolTemplate" ADD COLUMN     "productionType" TEXT NOT NULL DEFAULT 'broiler';

-- CreateTable
CREATE TABLE "EggGrade" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "minGrams" INTEGER,
    "maxGrams" INTEGER,

    CONSTRAINT "EggGrade_pkey" PRIMARY KEY ("id")
);

