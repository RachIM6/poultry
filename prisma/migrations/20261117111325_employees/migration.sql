-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "phone" TEXT,
    "userId" UUID,
    "housedOnFarm" BOOLEAN NOT NULL,
    "startedOn" DATE NOT NULL,
    "leftOn" DATE,
    "dailyWageCentimes" BIGINT NOT NULL,
    "cnssNumber" TEXT,
    "houseIds" UUID[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_farmId_userId_key" ON "Employee"("farmId", "userId");
