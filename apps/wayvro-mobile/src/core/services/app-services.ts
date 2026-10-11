import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { createIdempotencyIntentStore } from '../api/idempotency-intents';
import type { ServerClock } from '../api/http';
import { createRefreshCall, createWayvroClient, type DeviceInfo, type WayvroClient } from '../api/wayvro-client';
import { loadUiLocale } from '../i18n/locale-preference';
import type { UiLocale } from '../i18n/strings';
import { randomBytes, sha256Hex } from '../platform/crypto';
import { newIdempotencyKey, newRequestId } from '../platform/ids';
import { createQueryClient } from '../query/query-client';
import { loadOrCreateInstallationId } from '../session/installation-id';
import type { KeyValueStore } from '../session/key-value-store';
import { secureTokenStore } from '../session/secure-token-store';
import { SessionManager } from '../session/session-manager';
import { SignInFlow } from '../session/sign-in-flow';

/**
 * Composition root of the app (the only place that binds the platform adapters: secure storage, CSPRNG, fetch). The
 * services are created once per process after the API configuration is known.
 */
export interface AppServices {
  readonly store: KeyValueStore;
  readonly session: SessionManager;
  readonly client: WayvroClient;
  readonly clock: ServerClock;
  readonly queryClient: QueryClient;
  readonly signInFlow: SignInFlow;
  readonly initialLocale: UiLocale;
}

const APP_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;

function deviceInfo(appVersion: string | undefined): DeviceInfo {
  return {
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    appVersion: appVersion !== undefined && APP_VERSION_PATTERN.test(appVersion) ? appVersion : '0.0.0',
  };
}

export async function createAppServices(baseUrl: string, appVersion: string | undefined): Promise<AppServices> {
  const store = secureTokenStore;
  const clock: ServerClock = { offsetMs: 0 };
  const http = { baseUrl, fetchFn: fetch, newRequestId: () => newRequestId(randomBytes), clock };
  const [installationId, initialLocale] = await Promise.all([loadOrCreateInstallationId(store, randomBytes), loadUiLocale(store)]);

  const session = new SessionManager({ store, refreshCall: createRefreshCall(http), newIdempotencyKey: () => newIdempotencyKey(randomBytes) });
  const intents = createIdempotencyIntentStore(store, () => newIdempotencyKey(randomBytes));
  const queryClient = createQueryClient();
  const signInFlow = new SignInFlow();
  // Sign-out/expiry wipe: tokens (SessionManager) + installation-scoped data. The installation id is kept.
  session.onWipe(() => intents.clear());
  session.onWipe(() => {
    queryClient.clear();
  });
  session.onWipe(() => {
    signInFlow.reset();
  });
  // P2.8 (Q01): Driver/Partner evidence photos still on the phone and the upload queue metadata. The module is loaded
  // only when a wipe runs, so riders never evaluate the Driver/Partner code at start-up.
  session.onWipe(async () => {
    const { wipeEvidence } = await import('../../features/driver/upload/runner-registry');
    await wipeEvidence(store);
  });
  await session.load();

  const client = createWayvroClient({ http, session, intents, installationId, device: deviceInfo(appVersion), fingerprint: sha256Hex });
  return { store, session, client, clock, queryClient, signInFlow, initialLocale };
}
