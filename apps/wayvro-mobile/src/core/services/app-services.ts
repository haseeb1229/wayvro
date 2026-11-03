import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { createIdempotencyIntentStore } from '../api/idempotency-intents';
import type { HttpObservation, ServerClock } from '../api/http';
import { createRefreshCall, createWayvroClient, type WayvroClient } from '../api/wayvro-client';
import { loadUiLocale } from '../i18n/locale-preference';
import type { UiLocale } from '../i18n/strings';
import { systemIntents } from '../intents/deferred';
import { LiteModeStore } from '../lite/lite-mode';
import { ModeController } from '../mode/mode-controller';
import { randomBytes, sha256Hex } from '../platform/crypto';
import { newIdempotencyKey, newRequestId, newUuidV4 } from '../platform/ids';
import { createQueryClient } from '../query/query-client';
import { appHeaders, appIdentity, type EmbeddedConfig } from '../release/app-identity';
import { AppPolicyStore } from '../release/app-policy-store';
import { loadOrCreateInstallationId } from '../session/installation-id';
import type { KeyValueStore } from '../session/key-value-store';
import { secureTokenStore } from '../session/secure-token-store';
import { SessionManager } from '../session/session-manager';
import { SignInFlow } from '../session/sign-in-flow';

/**
 * Composition root of the app (the only place that binds the platform adapters: secure storage, CSPRNG, fetch). The
 * services are created once per process after the API configuration is known. Nothing here requests a permission,
 * starts background work or evaluates a Driver/Partner module.
 */
export interface AppServices {
  readonly store: KeyValueStore;
  readonly session: SessionManager;
  readonly client: WayvroClient;
  readonly clock: ServerClock;
  readonly queryClient: QueryClient;
  readonly signInFlow: SignInFlow;
  readonly initialLocale: UiLocale;
  /** P3.5: app-policy gate state (A01/Q31). */
  readonly policy: AppPolicyStore;
  /** P3.5: Lite preference + request-timing heuristic (L08). */
  readonly lite: LiteModeStore;
  /** P3.5: mode preference hint, last quote record, mode notices (V08). */
  readonly modes: ModeController;
  /** Random v4 UUIDs (per-field search sessions, quote attempts). */
  readonly newUuid: () => string;
}

export async function createAppServices(baseUrl: string, embedded: EmbeddedConfig | null): Promise<AppServices> {
  const store = secureTokenStore;
  const clock: ServerClock = { offsetMs: 0 };
  const identity = appIdentity(Platform.OS, embedded);
  // Timing/outcome observers (no URL, body or header reaches them): the policy gate reacts to 426/503-maintenance on
  // ANY call; the Lite heuristic counts slow responses and timeouts.
  const observers: ((observation: HttpObservation) => void)[] = [];
  const http = {
    baseUrl,
    fetchFn: fetch,
    newRequestId: () => newRequestId(randomBytes),
    clock,
    appHeaders: appHeaders(identity),
    observe: (observation: HttpObservation) => {
      for (const observer of observers) observer(observation);
    },
  };
  const [installationId, initialLocale] = await Promise.all([loadOrCreateInstallationId(store, randomBytes), loadUiLocale(store)]);

  const session = new SessionManager({ store, refreshCall: createRefreshCall(http), newIdempotencyKey: () => newIdempotencyKey(randomBytes) });
  const intents = createIdempotencyIntentStore(store, () => newIdempotencyKey(randomBytes));
  const queryClient = createQueryClient();
  const signInFlow = new SignInFlow();
  const client = createWayvroClient({
    http,
    session,
    intents,
    installationId,
    device: { platform: identity.platform, appVersion: identity.version },
    fingerprint: sha256Hex,
  });
  const policy = new AppPolicyStore({ fetchConfig: () => client.appConfig(), store, build: identity.build });
  const lite = new LiteModeStore(store, () => {
    const { tuning } = policy.getState();
    return { slowRequestMs: tuning.liteSlowRequestMs, suggestAfterSlowRequests: tuning.liteSuggestAfterSlowRequests };
  });
  const modes = new ModeController(store);
  observers.push((observation) => {
    policy.report(observation.error);
    lite.record(observation);
  });

  // Sign-out/expiry wipe: tokens (SessionManager) + installation-scoped data. The installation id, UI language, Lite
  // preference and cached app policy are kept (installation-scoped, non-personal).
  session.onWipe(() => intents.clear());
  session.onWipe(() => {
    queryClient.clear();
  });
  session.onWipe(() => {
    signInFlow.reset();
  });
  // P3.5: the mode preference and the last quote record belong to the signed-out account; held intents too.
  session.onWipe(() => {
    systemIntents.clear();
    return modes.wipe();
  });
  // P2.8 (Q01): Driver/Partner evidence photos still on the phone and the upload queue metadata. The module is loaded
  // only when a wipe runs, so riders never evaluate the Driver/Partner code at start-up.
  session.onWipe(async () => {
    const { wipeEvidence } = await import('../../features/driver/upload/runner-registry');
    await wipeEvidence(store);
  });
  await Promise.all([session.load(), policy.load(), lite.load(), modes.load()]);

  return {
    store,
    session,
    client,
    clock,
    queryClient,
    signInFlow,
    initialLocale,
    policy,
    lite,
    modes,
    newUuid: () => newUuidV4(randomBytes),
  };
}
