-- Custom migration: drizzle-kit cannot emit geography typmods (see schema.ts); enforce Point/SRID 4326 here.
ALTER TABLE "driver_presence" ALTER COLUMN "geog" TYPE geography(Point,4326);
