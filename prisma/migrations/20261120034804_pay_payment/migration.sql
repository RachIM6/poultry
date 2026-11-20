-- CreateTable
CREATE TABLE "PayPayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "paidFrom" TEXT NOT NULL,
    "netCentimes" BIGINT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayPayment_organizationId_idx" ON "PayPayment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPayment_farmId_month_key" ON "PayPayment"("farmId", "month");
