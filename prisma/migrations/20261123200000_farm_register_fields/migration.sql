-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "chickImportApproval" TEXT,
ADD COLUMN     "holderAddress" TEXT,
ADD COLUMN     "holderName" TEXT,
ADD COLUMN     "technicianName" TEXT,
ADD COLUMN     "vetAddress" TEXT,
ADD COLUMN     "vetName" TEXT,
ADD COLUMN     "vetPhone" TEXT;

-- CreateTable
CREATE TABLE "RegisterKeeper" (
    "farmId" UUID NOT NULL,
    "n" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "fromOn" DATE NOT NULL,
    "toOn" DATE,

    CONSTRAINT "RegisterKeeper_pkey" PRIMARY KEY ("farmId","n")
);

-- CreateIndex
CREATE INDEX "RegisterKeeper_organizationId_idx" ON "RegisterKeeper"("organizationId");

-- AddForeignKey
ALTER TABLE "RegisterKeeper" ADD CONSTRAINT "RegisterKeeper_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

