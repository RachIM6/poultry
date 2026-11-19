-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "ageAtPlacementDays" INTEGER NOT NULL DEFAULT 0;


-- SPEC-m3 B8: beldi bands share a run; every other type keeps one open batch per house.
DROP INDEX "Batch_one_open_per_house";
CREATE UNIQUE INDEX "Batch_one_open_per_house" ON "Batch"("houseId") WHERE status = 'open' AND species <> 'beldi';
