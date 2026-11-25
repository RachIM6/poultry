-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "priceCentimes" BIGINT NOT NULL,
    "seenOn" TEXT,
    "byUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceObservation_organizationId_product_day_idx" ON "PriceObservation"("organizationId", "product", "day");
