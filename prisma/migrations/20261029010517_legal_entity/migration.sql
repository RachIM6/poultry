-- CreateEnum
CREATE TYPE "LegalForm" AS ENUM ('individual', 'indivision', 'company', 'cooperative', 'association', 'gie');

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "form" "LegalForm" NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalEntity_organizationId_idx" ON "LegalEntity"("organizationId");

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
