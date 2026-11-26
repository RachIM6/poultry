-- tasks/plan-ui.md U20: a user's first and last name, typed at sign-up. Null for the accounts made before: their
-- display name (`name`) stays their phone number until they set one.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT;

-- The code caps each at 50 characters (identity/schema.ts NAME_MAX); the database refuses anything longer too.
ALTER TABLE "User" ADD CONSTRAINT "User_firstName_length" CHECK (char_length("firstName") BETWEEN 1 AND 50);
ALTER TABLE "User" ADD CONSTRAINT "User_lastName_length" CHECK (char_length("lastName") BETWEEN 1 AND 50);
