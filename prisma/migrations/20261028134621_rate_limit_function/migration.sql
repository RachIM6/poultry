-- One call = lock, prune, count, insert for every key of a rate-limit policy (src/lib/security/rate-limit.ts).
-- Runs as a single statement, so no client-held transaction can expire while the Node server stalls.
-- In READ COMMITTED each statement in this VOLATILE function takes a new snapshot: counting after the lock
-- sees every concurrent request of the same policy that committed first.
CREATE FUNCTION rate_limit_consume(lock_name text, keys text[], windows int[])
RETURNS TABLE (hit_key text, hits int)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(lock_name));

  DELETE FROM "RateLimitHit" h
  USING unnest(keys, windows) AS k(k_key, k_win)
  WHERE h.key = k.k_key AND h.at <= now() - make_interval(secs => k.k_win);

  RETURN QUERY
    SELECT k.k_key, (SELECT count(*)::int FROM "RateLimitHit" h WHERE h.key = k.k_key)
    FROM unnest(keys) AS k(k_key);

  INSERT INTO "RateLimitHit" (key) SELECT unnest(keys);
END $$;
