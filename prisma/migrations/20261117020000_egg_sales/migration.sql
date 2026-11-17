-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'live';

-- CreateTable
CREATE TABLE "EggDraw" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "laidOn" DATE NOT NULL,
    "item" TEXT NOT NULL,
    "eggs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EggDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "saleId" UUID NOT NULL,
    "n" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "item" TEXT NOT NULL,
    "eggs" INTEGER NOT NULL,
    "eggsPerTray" INTEGER NOT NULL,
    "unitPriceCentimes" BIGINT NOT NULL,
    "amountCentimes" BIGINT NOT NULL,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("saleId","n")
);

-- CreateIndex
CREATE INDEX "EggDraw_organizationId_batchId_idx" ON "EggDraw"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "SaleLine_organizationId_idx" ON "SaleLine"("organizationId");

