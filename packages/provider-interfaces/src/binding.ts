/**
 * Provider binding guard (GR-05, I04). Each service binds the providers it needs at boot. Binding a mock outside
 * `local`/`test` throws, so a misconfigured staging/production process refuses to start rather than silently
 * "succeeding" against a fake. Unbound providers fail loudly when used.
 */
import { InMemoryObjectStorage, RecordingOtpDelivery, RecordingPushNotification, isMockProvider } from './mocks.js';
import { isNonProductionLike, type WayvroEnv } from '@wayvro/config';
import { PROVIDER_KINDS, type ProviderKind, type ProviderPorts } from './ports.js';

export class ProviderBindingError extends Error {
  override readonly name = 'ProviderBindingError';
}

export interface ProviderRegistry {
  get<K extends ProviderKind>(kind: K): ProviderPorts[K];
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
    get(kind) {
      const impl = bindings[kind];
      if (impl === undefined) throw new ProviderBindingError(`provider "${kind}" is not bound in WAYVRO_ENV=${env}`);
      return impl;
    },
  };
}

/** Default bindings: local/test get recording mocks; other environments get nothing until real adapters exist. */
export function defaultProviderBindings(env: WayvroEnv): Partial<ProviderPorts> {
  if (!isNonProductionLike(env)) return {};
  return { objectStorage: new InMemoryObjectStorage(), otpDelivery: new RecordingOtpDelivery(), pushNotification: new RecordingPushNotification() };
}
