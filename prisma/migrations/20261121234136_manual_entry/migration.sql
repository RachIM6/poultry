-- CreateTable
CREATE TABLE "ManualEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "piece" TEXT,
    "receiptFileId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualEntry_organizationId_idx" ON "ManualEntry"("organizationId");
