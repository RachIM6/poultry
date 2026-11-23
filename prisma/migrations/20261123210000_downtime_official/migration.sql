-- SPEC-m2-compliance CQ3, SPEC-m5 NQ4 (decided default, to review, 2026-11-23).
-- CQ3: planning's DowntimeRule is the one downtime figure; the official 20 days (arrêté n° 2127-05 du 15 décembre 2005,
-- art. 4) are built into the code. A farm's former biosecurity minimum above them becomes a dated rule (valid from the
-- farm's creation, signed by the organisation's oldest owner), synced to the phones and audited; one at or below them
-- adds nothing. Then the setting goes.
DO $$
DECLARE
  r RECORD;
  rid UUID;
  v BIGINT;
  rule JSONB;
BEGIN
  FOR r IN
    SELECT s."organizationId", s."farmId", s."minDays", (f."createdAt" AT TIME ZONE 'Africa/Casablanca')::date AS "validFrom", o."userId"
    FROM "DowntimeSetting" s
    JOIN "Farm" f ON f.id = s."farmId"
    JOIN LATERAL (
      SELECT m."userId" FROM "Membership" m WHERE m."organizationId" = s."organizationId" AND m.role = 'owner' ORDER BY m."createdAt" LIMIT 1
    ) o ON true
    WHERE s."minDays" > 20
  LOOP
    rid := uuidv7();
    rule := jsonb_build_object('id', rid, 'farmId', r."farmId", 'validFrom', to_char(r."validFrom", 'YYYY-MM-DD'), 'minDays', r."minDays",
      'source', 'Minimum de la ferme saisi sur l''écran Nettoyage, sans source (repris le 23/11/2026)');
    INSERT INTO "DowntimeRule" ("id", "organizationId", "farmId", "validFrom", "minDays", "source", "createdBy")
      VALUES (rid, r."organizationId", r."farmId", r."validFrom", r."minDays", rule->>'source', r."userId");
    INSERT INTO "SyncVersion" ("organizationId", version) VALUES (r."organizationId", 1)
      ON CONFLICT ("organizationId") DO UPDATE SET version = "SyncVersion".version + 1
      RETURNING version INTO v;
    INSERT INTO "Change" ("organizationId", version, entity, "entityId", data) VALUES (r."organizationId", v, 'downtimeRule', rid, rule);
    INSERT INTO "AuditEvent" ("organizationId", entity, "entityId", action, after) VALUES (r."organizationId", 'DowntimeRule', rid, 'create', rule);
  END LOOP;
END $$;

DROP TABLE "DowntimeSetting";
