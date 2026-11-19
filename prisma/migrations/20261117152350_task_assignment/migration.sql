-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "employeeId" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAssignment_organizationId_idx" ON "TaskAssignment"("organizationId");
