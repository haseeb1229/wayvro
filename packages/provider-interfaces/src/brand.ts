/**
 * Test-double brand (ADR-045). Recording/in-memory doubles live only in the dev-only test-double workspace package,
 * which is never part of a deployable artefact. They still carry this brand so that the binding guard can refuse them
 * as defence in depth if a double were ever passed to a staging/production composition.
 * This file is the only production file that contains the brand key (checked by scripts/artifact-isolation.mjs).
 */
export const MOCK_PROVIDER: unique symbol = Symbol.for('wayvro.provider.mock');

export interface MockBrand {
  readonly [MOCK_PROVIDER]: true;
}

export function isMockProvider(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Partial<MockBrand>)[MOCK_PROVIDER] === true;
}
