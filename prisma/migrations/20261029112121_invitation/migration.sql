-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organizationId" UUID NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invitation_phoneNumber_idx" ON "Invitation"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_organizationId_phoneNumber_key" ON "Invitation"("organizationId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
