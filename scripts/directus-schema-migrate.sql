-- MIGRATION: Move all directus_* tables from public → directus schema.
-- Run ONLY after preflight passes (zero cross-FKs, backup taken, Directus stopped).
-- Connect: docker compose -f docker-compose.dev.yml exec postgres psql -U triolla -d triolla

BEGIN;

CREATE SCHEMA IF NOT EXISTS directus AUTHORIZATION triolla;

-- Move all directus_* tables (indexes, constraints, triggers move automatically)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'directus_%'
    ORDER BY tablename
  LOOP
    RAISE NOTICE 'Moving table: %', r.tablename;
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA directus', r.tablename);
  END LOOP;
END $$;

-- Move any free-standing sequences not owned by a moved table
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT sequence_name FROM information_schema.sequences
    WHERE sequence_schema = 'public' AND sequence_name LIKE 'directus_%'
  LOOP
    RAISE NOTICE 'Moving sequence: %', r.sequence_name;
    EXECUTE format('ALTER SEQUENCE public.%I SET SCHEMA directus', r.sequence_name);
  END LOOP;
END $$;

-- Verify before committing
DO $$
DECLARE
  public_count  int;
  directus_count int;
BEGIN
  SELECT COUNT(*) INTO public_count
  FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'directus_%';

  SELECT COUNT(*) INTO directus_count
  FROM pg_tables WHERE schemaname = 'directus' AND tablename LIKE 'directus_%';

  RAISE NOTICE 'Tables remaining in public: %', public_count;
  RAISE NOTICE 'Tables now in directus schema: %', directus_count;

  IF public_count > 0 THEN
    RAISE EXCEPTION 'ABORT: % directus_* tables still in public schema', public_count;
  END IF;
  IF directus_count = 0 THEN
    RAISE EXCEPTION 'ABORT: No directus_* tables found in directus schema';
  END IF;
END $$;

COMMIT;

-- POST-COMMIT verification (run separately after COMMIT succeeds)
-- SELECT schemaname, COUNT(*) FROM pg_tables WHERE tablename LIKE 'directus_%' GROUP BY schemaname;
-- Expected: directus | 26  (zero rows for public)
--
-- SELECT COUNT(*) FROM directus.directus_users;
-- Must match count from preflight step 3.
