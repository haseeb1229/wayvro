-- wayvro-migration: 0000_postgis
-- compatibility: additive (expand); no table or column changes; safe with any application version
-- data-impact: none — enables the PostGIS extension (geography/geometry types and spatial functions)
-- rollback: forward-fix only; DROP EXTENSION postgis becomes destructive once spatial columns exist. Managed PostgreSQL must allow CREATE EXTENSION postgis for the migration role.
-- verification: SELECT extversion FROM pg_extension WHERE extname = 'postgis'; -- expect 3.5.x
CREATE EXTENSION IF NOT EXISTS postgis;
