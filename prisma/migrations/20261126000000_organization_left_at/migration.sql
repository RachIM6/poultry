-- ADR-007, docs/data-requests.md: when the organisation left the platform; its data is deleted 30 days later.
ALTER TABLE "Organization" ADD COLUMN "leftAt" TIMESTAMPTZ;
