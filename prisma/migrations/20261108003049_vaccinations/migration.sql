-- CreateTable
CREATE TABLE "Vaccination" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "dayOfAge" INTEGER NOT NULL,
    "dueOn" DATE NOT NULL,
    "productId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "doneOn" DATE,
    "stockItemId" UUID,
    "doses" INTEGER,
    "doneMethod" TEXT,
    "doneBy" UUID,
    "remindedBeforeAt" TIMESTAMPTZ,
    "remindedDueAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vaccination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vaccination_organizationId_batchId_idx" ON "Vaccination"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "Vaccination_dueOn_idx" ON "Vaccination"("dueOn");
