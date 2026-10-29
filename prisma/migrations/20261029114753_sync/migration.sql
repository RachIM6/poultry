-- CreateTable
CREATE TABLE "Mutation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncVersion" (
    "organizationId" UUID NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "SyncVersion_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "Change" (
    "organizationId" UUID NOT NULL,
    "version" BIGINT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "data" JSONB,

    CONSTRAINT "Change_pkey" PRIMARY KEY ("organizationId","version")
);

-- CreateIndex
CREATE INDEX "Mutation_organizationId_idx" ON "Mutation"("organizationId");
