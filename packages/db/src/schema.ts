/**
 * Drizzle table definitions (typed query layer, ADR-004). Phase 1 deliberately defines no product tables: the
 * first tables arrive with the Phase 2 identity context. PostGIS columns are never declared here for DDL generation —
 * they are created by reviewed custom SQL migrations because drizzle-kit 0.31 mis-emits PostGIS types.
 */
export {};
