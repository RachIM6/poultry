-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "sex" TEXT NOT NULL DEFAULT 'mixed';


-- SPEC-m3 B9: a turkey batch of each sex may share a house; every other type keeps one open batch per house.
DROP INDEX "Batch_one_open_per_house";
CREATE UNIQUE INDEX "Batch_one_open_per_house" ON "Batch"("houseId", sex) WHERE status = 'open' AND species <> 'beldi';
