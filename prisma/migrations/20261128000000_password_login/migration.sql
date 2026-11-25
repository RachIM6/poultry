-- ADR-015: password login (phone or email), one-time invite and reset codes, stored as HMACs only.

-- Emails are a login identifier, compared lowercase: the code lowercases them, the database refuses any other.
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK (email = lower(email));

-- An invitation is accepted with its code. Invitations made before codes have none and can't be accepted that way.
ALTER TABLE "Invitation" ADD COLUMN "codeHash" TEXT;
CREATE UNIQUE INDEX "Invitation_codeHash_key" ON "Invitation"("codeHash");

CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "issuedById" UUID,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordReset_codeHash_key" ON "PasswordReset"("codeHash");
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table (migration *_row_level_security): no row for Supabase's public Data API roles.
ALTER TABLE "PasswordReset" ENABLE ROW LEVEL SECURITY;
