-- CreateTable
CREATE TABLE "TaskDone" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDone_organizationId_idx" ON "TaskDone"("organizationId");
