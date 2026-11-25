-- Only for a database older than PostgreSQL 18 (Supabase runs 17): run once, before the first `prisma migrate deploy`.
-- The migrations use PostgreSQL 18's built-in uuidv7() as the fallback id default (SPEC §6); this is the same RFC 9562
-- UUIDv7 (48-bit Unix time in ms, version 7, variant 10, random rest), without 18's sub-millisecond ordering.
-- On 18 and later it is never called: pg_catalog's uuidv7() comes first in the search path.
CREATE OR REPLACE FUNCTION public.uuidv7() RETURNS uuid LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
    52, 1), 53, 1),
  'hex')::uuid
$$;
