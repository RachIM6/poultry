-- DropIndex
DROP INDEX "StandardCurve_strainId_version_key";

-- AlterTable
ALTER TABLE "StandardCurve" ADD COLUMN     "sex" TEXT NOT NULL DEFAULT 'mixed';

-- CreateTable
CREATE TABLE "LayingCurve" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "strainId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "LayingCurve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayingPoint" (
    "curveId" UUID NOT NULL,
    "week" INTEGER NOT NULL,
    "layingRatePermille" INTEGER,
    "eggsPerHenHousedTenths" INTEGER,
    "eggWeightDg" INTEGER,
    "feedGramsPerHenDay" INTEGER,
    "bodyWeightGrams" INTEGER,

    CONSTRAINT "LayingPoint_pkey" PRIMARY KEY ("curveId","week")
);

-- CreateIndex
CREATE UNIQUE INDEX "LayingCurve_strainId_version_key" ON "LayingCurve"("strainId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StandardCurve_strainId_version_sex_key" ON "StandardCurve"("strainId", "version", "sex");

-- AddForeignKey
ALTER TABLE "LayingCurve" ADD CONSTRAINT "LayingCurve_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayingPoint" ADD CONSTRAINT "LayingPoint_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "LayingCurve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

