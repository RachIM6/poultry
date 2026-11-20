-- CreateTable
CREATE TABLE "CaptchaUse" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CaptchaUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptchaUse_expiresAt_idx" ON "CaptchaUse"("expiresAt");
