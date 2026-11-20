-- AlterTable
ALTER TABLE "Strain" ADD COLUMN     "productionTypes" TEXT[] DEFAULT ARRAY['broiler']::TEXT[];
