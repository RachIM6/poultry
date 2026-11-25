-- CreateTable
CREATE TABLE "SoldBirds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "birds" INTEGER NOT NULL,
    "liveWeightGrams" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldBirds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "birds" INTEGER NOT NULL,
    "farmWeightGrams" INTEGER NOT NULL,
    "buyerWeightGrams" INTEGER,
    "pricePerKgCentimes" BIGINT NOT NULL,
    "amountCentimes" BIGINT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paidCentimes" BIGINT NOT NULL,
    "instrumentNumber" TEXT,
    "instrumentDueOn" DATE,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SoldBirds_organizationId_batchId_idx" ON "SoldBirds"("organizationId", "batchId");

-- CreateIndex
CREATE INDEX "Buyer_organizationId_idx" ON "Buyer"("organizationId");

-- CreateIndex
CREATE INDEX "Sale_organizationId_batchId_idx" ON "Sale"("organizationId", "batchId");
