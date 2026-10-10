// SPIKE-ONLY schema used to exercise drizzle-kit migrations, PostGIS types and assignment invariants.
// It is NOT the Wayvro product schema (that is designed in Phase 4 with the dispatch context).
import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, customType, index, integer, pgTable, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const geographyPoint = customType<{ data: string; driverData: string }>({
  // drizzle-kit 0.31.x always double-quotes custom type names, so a typmod such as (Point,4326) produces invalid DDL.
  // The bare type is emitted here; migration 0002 (custom SQL) applies the Point/4326 typmod.
  dataType: () => 'geography',
});

export const driverPresence = pgTable(
  'driver_presence',
  {
    driverId: bigint('driver_id', { mode: 'number' }).primaryKey(),
    geog: geographyPoint('geog').notNull(),
    online: boolean('online').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    vehicleClass: smallint('vehicle_class').notNull(),
    restricted: boolean('restricted').notNull().default(false),
    busy: boolean('busy').notNull().default(false),
  },
  (t) => [
    index('driver_presence_geog_gist').using('gist', t.geog),
    index('driver_presence_online_class_idx').on(t.vehicleClass).where(sql`online and not restricted and not busy`),
  ],
);

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ride_requests_status_chk', sql`${t.status} in ('SEARCHING','ASSIGNED','CANCELLED')`)],
);

export const offers = pgTable(
  'offers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rideId: bigint('ride_id', { mode: 'number' }).notNull().references(() => rideRequests.id),
    driverId: bigint('driver_id', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // v2 (expand step): nullable column added in a later migration to exercise previous-schema -> new.
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    check('offers_status_chk', sql`${t.status} in ('OFFERED','ACCEPTED','EXPIRED','REJECTED')`),
    index('offers_ride_idx').on(t.rideId),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rideId: bigint('ride_id', { mode: 'number' }).notNull().references(() => rideRequests.id),
    driverId: bigint('driver_id', { mode: 'number' }).notNull(),
    offerId: bigint('offer_id', { mode: 'number' }).references(() => offers.id),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('assignments_status_chk', sql`${t.status} in ('ACTIVE','ENDED')`),
    // Database-enforced invariants: at most one ACTIVE assignment per ride and per driver.
    uniqueIndex('assignments_one_active_per_ride').on(t.rideId).where(sql`status = 'ACTIVE'`),
    uniqueIndex('assignments_one_active_per_driver').on(t.driverId).where(sql`status = 'ACTIVE'`),
  ],
);
