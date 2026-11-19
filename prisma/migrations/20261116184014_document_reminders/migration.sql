-- CreateTable
CREATE TABLE "DocumentReminder" (
    "subjectId" UUID NOT NULL,
    "expiresOn" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DocumentReminder_pkey" PRIMARY KEY ("subjectId","expiresOn","kind")
);
