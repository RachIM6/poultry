-- CreateTable
CREATE TABLE "Routine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID,
    "title" TEXT NOT NULL,
    "time" TEXT,
    "everyDays" INTEGER NOT NULL,
    "startOn" DATE,
    "fromAge" INTEGER,
    "stopOn" DATE,
    "employeeId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Routine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneOffTask" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "houseId" UUID,
    "day" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "time" TEXT,
    "employeeId" UUID,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneOffTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Routine_organizationId_idx" ON "Routine"("organizationId");

-- CreateIndex
CREATE INDEX "OneOffTask_organizationId_day_idx" ON "OneOffTask"("organizationId", "day");
