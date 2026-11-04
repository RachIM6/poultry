-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('feed', 'vaccine', 'medicine');

-- CreateTable
CREATE TABLE "Strain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Strain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardCurve" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "strainId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "StandardCurve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardPoint" (
    "curveId" UUID NOT NULL,
    "day" INTEGER NOT NULL,
    "bodyWeightGrams" INTEGER NOT NULL,
    "cumulativeFeedGrams" INTEGER NOT NULL,

    CONSTRAINT "StandardPoint_pkey" PRIMARY KEY ("curveId","day")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "withdrawalDays" INTEGER,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolTemplate" (
    "id" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "reviewedByVet" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL,

    CONSTRAINT "ProtocolTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccinationProtocol" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" TEXT,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "VaccinationProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandardCurve_strainId_version_key" ON "StandardCurve"("strainId", "version");

-- CreateIndex
CREATE INDEX "VaccinationProtocol_organizationId_idx" ON "VaccinationProtocol"("organizationId");

-- AddForeignKey
ALTER TABLE "StandardCurve" ADD CONSTRAINT "StandardCurve_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardPoint" ADD CONSTRAINT "StandardPoint_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "StandardCurve"("id") ON DELETE CASCADE ON UPDATE CASCADE;
