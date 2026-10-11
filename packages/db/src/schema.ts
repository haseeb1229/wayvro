/**
 * Drizzle table definitions (typed query layer, ADR-004). The P2.1 identity tables (migration 0001_identity_core) are
 * accessed through explicit, parameterised SQL because nearly every statement is concurrency-sensitive (CAS updates,
 * `ON CONFLICT`, `FOR UPDATE SKIP LOCKED`) — the path ADR-004 reserves for explicit SQL. Typed builder definitions are
 * added when a context with ordinary CRUD benefits from them. PostGIS columns are never declared here for DDL
 * generation; they are created by reviewed custom SQL migrations because drizzle-kit 0.31 mis-emits PostGIS types.
 */
export {};
