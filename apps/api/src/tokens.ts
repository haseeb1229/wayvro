/**
 * Explicit DI tokens. Every constructor dependency is injected with `@Inject(TOKEN)`, so the API does not rely on
 * TypeScript's legacy `emitDecoratorMetadata` (ADR-005): it builds with plain `tsc`, runs under Vitest/esbuild and is
 * not blocked by decorator-metadata support in future TypeScript compilers.
 */
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const SERVICE_INFO = Symbol('SERVICE_INFO');
export const OTP_SERVICE = Symbol('OTP_SERVICE');
export const SESSION_SERVICE = Symbol('SESSION_SERVICE');
export const ACCOUNT_SERVICE = Symbol('ACCOUNT_SERVICE');
export const CONSENT_SERVICE = Symbol('CONSENT_SERVICE');
export const LEGAL_DB = Symbol('LEGAL_DB');
export const STAFF_AUTH_SERVICE = Symbol('STAFF_AUTH_SERVICE');
export const STAFF_ADMIN_SERVICE = Symbol('STAFF_ADMIN_SERVICE');
export const STAFF_OVERSIGHT_SERVICE = Symbol('STAFF_OVERSIGHT_SERVICE');
export const ONBOARDING_SERVICE = Symbol('ONBOARDING_SERVICE');
export const COMPLIANCE_ADMIN_SERVICE = Symbol('COMPLIANCE_ADMIN_SERVICE');
export const EVIDENCE_SERVICES = Symbol('EVIDENCE_SERVICES');

export interface ServiceInfo {
  readonly service: string;
  readonly version: string;
}
