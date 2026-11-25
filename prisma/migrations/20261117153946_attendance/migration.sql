-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "arrivedAt" TEXT,
    "userId" UUID,
    "updatedBy" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attendance_organizationId_day_idx" ON "Attendance"("organizationId", "day");
