-- The balance trigger runs for both tables: read the entry id through to_jsonb(NEW), because PL/pgSQL rejects a
-- reference to a column the row doesn't have ("entryId" on a JournalEntry row), even in a branch not taken.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  entry uuid := (to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'JournalEntry' THEN 'id' ELSE 'entryId' END)::uuid;
  n int;
  balance numeric;
BEGIN
  SELECT count(*), coalesce(sum("debitCentimes" - "creditCentimes"), 0) INTO n, balance FROM "JournalLine" WHERE "entryId" = entry;
  IF n < 2 OR balance <> 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (% lines, balance %)', entry, n, balance USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
