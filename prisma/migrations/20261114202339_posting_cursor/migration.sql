-- CreateTable
CREATE TABLE "PostingCursor" (
    "organizationId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "PostingCursor_pkey" PRIMARY KEY ("organizationId","source")
);
