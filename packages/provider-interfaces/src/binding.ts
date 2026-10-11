/**
 * Provider binding guard (GR-05, I04, ADR-045). Production composition roots bind real adapters only; test doubles
 * are physically absent from deployable artefacts. As defence in depth, binding a branded test double outside
 * `local`/`test` still throws, so a misconfigured staging/production process refuses to start rather than silently
 * "succeeding" against a fake. Unbound providers fail loudly when used.
 */
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { isMockProvider } from './brand.js';
import { PROVIDER_KINDS, type ProviderKind, type ProviderPorts } from './ports.js';

export class ProviderBindingError extends Error {
  override readonly name = 'ProviderBindingError';
}

export interface ProviderRegistry {
  get<K extends ProviderKind>(kind: K): ProviderPorts[K];
  /** True when an implementation is bound; features with an unbound port answer `503 WAYVRO_E_DEPENDENCY_UNAVAILABLE`. */
  has(kind: ProviderKind): boolean;
  readonly bound: readonly ProviderKind[];
}

export function bindProviders(env: WayvroEnv, bindings: Partial<ProviderPorts>): ProviderRegistry {
  const mockAllowed = isNonProductionLike(env);
  for (const kind of PROVIDER_KINDS) {
    const impl = bindings[kind];
    if (impl !== undefined && isMockProvider(impl) && !mockAllowed) {
      throw new ProviderBindingError(`refusing to bind mock provider "${kind}" in WAYVRO_ENV=${env}`);
    }
  }
  return {
    bound: PROVIDER_KINDS.filter((k) => bindings[k] !== undefined),
    has: (kind) => bindings[kind] !== undefined,
    get(kind) {
      const impl = bindings[kind];
      if (impl === undefined) throw new ProviderBindingError(`provider "${kind}" is not bound in WAYVRO_ENV=${env}`);
      return impl;
    },
  };
}
