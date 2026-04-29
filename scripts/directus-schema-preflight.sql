-- PRE-FLIGHT: Run this first. All checks must pass before running the migration.
-- Connect: docker compose -f docker-compose.dev.yml exec postgres psql -U triolla -d triolla

-- 1. List all directus_* tables in public (expect ~26)
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'directus_%'
ORDER BY tablename;

-- 2. CRITICAL: Confirm zero FK crosses between Prisma tables and Directus tables.
--    If this returns any rows, STOP — do not proceed.
SELECT
  tc.table_name        AS "from_table",
  kcu.column_name      AS "from_column",
  ccu.table_name       AS "to_table",
  ccu.column_name      AS "to_column"
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.constraint_schema = 'public'
  AND (
    (tc.table_name LIKE 'directus_%' AND ccu.table_name NOT LIKE 'directus_%')
    OR
    (tc.table_name NOT LIKE 'directus_%' AND ccu.table_name LIKE 'directus_%')
  );
-- Expected result: 0 rows. Any rows = STOP.

-- 3. Snapshot row counts to verify data survives the move
SELECT 'directus_users'       AS t, COUNT(*) FROM directus_users
UNION ALL
SELECT 'directus_roles'       AS t, COUNT(*) FROM directus_roles
UNION ALL
SELECT 'directus_collections' AS t, COUNT(*) FROM directus_collections
UNION ALL
SELECT 'directus_fields'      AS t, COUNT(*) FROM directus_fields;
-- Save these numbers — verify them again after migration.

-- 4. Confirm _prisma_migrations is in public (not directus)
SELECT schemaname, tablename FROM pg_tables WHERE tablename = '_prisma_migrations';
-- Expected: public | _prisma_migrations

-- 5. Confirm pg_trgm extension location (must stay accessible to Prisma)
SELECT extname, nspname FROM pg_extension JOIN pg_namespace ON extnamespace = pg_namespace.oid
WHERE extname = 'pg_trgm';
-- Expected: pg_trgm | public  (fine, no action needed)
