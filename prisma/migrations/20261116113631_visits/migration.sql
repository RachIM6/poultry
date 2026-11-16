-- CreateTable
CREATE TABLE "Visit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "farmId" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ NOT NULL,
    "visitor" TEXT NOT NULL,
    "vehicle" TEXT,
    "purpose" TEXT NOT NULL,
    "recentFarm" BOOLEAN NOT NULL,
    "wheelsDisinfected" BOOLEAN NOT NULL,
    "footbath" BOOLEAN NOT NULL,
    "farmClothing" BOOLEAN NOT NULL,
    "zone" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_organizationId_farmId_enteredAt_idx" ON "Visit"("organizationId", "farmId", "enteredAt");
