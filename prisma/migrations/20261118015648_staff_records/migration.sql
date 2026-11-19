-- CreateTable
CREATE TABLE "StaffRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "topic" TEXT,
    "note" TEXT,
    "daysOff" INTEGER,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffRecord_organizationId_idx" ON "StaffRecord"("organizationId");
