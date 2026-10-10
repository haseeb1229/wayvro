/** Explicit DI tokens (no reliance on emitDecoratorMetadata — see ADR-005). */
export const CONNECTION_AUTHENTICATOR = Symbol('CONNECTION_AUTHENTICATOR');
export const LOGGER = Symbol('LOGGER');
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const REVALIDATE_INTERVAL_MS = Symbol('REVALIDATE_INTERVAL_MS');
export const SERVICE_INFO = Symbol('SERVICE_INFO');
