-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "userId" UUID,
    "phone" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);
