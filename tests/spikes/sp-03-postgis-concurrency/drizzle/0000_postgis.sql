-- Custom migration: enable PostGIS before any geography column exists.
CREATE EXTENSION IF NOT EXISTS postgis;
