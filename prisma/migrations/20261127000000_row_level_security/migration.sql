-- Supabase publishes the schema through its Data API (PostgREST) to the anon and authenticated roles, whose key is
-- public by design (docs/deploy-vercel-supabase.md). Row level security without any policy gives those roles no row.
-- The app and the migrations connect as the tables' owner, which RLS doesn't apply to (no FORCE), so on plain
-- PostgreSQL nothing changes. Every new table needs the same line (src/lib/db.int.test.ts checks it).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
