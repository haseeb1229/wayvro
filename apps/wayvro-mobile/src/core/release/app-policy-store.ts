import type { AppConfig } from '@wayvro/contracts';
import { ApiError } from '../api/errors';
import { STORAGE_KEYS, type KeyValueStore } from '../session/key-value-store';
import {
  evaluateClientPolicy,
  parseCachedPolicy,
  shouldFetchPolicy,
  snapshotOf,
  tuningOf,
  type CachedPolicy,
  type ClientPolicyView,
  type ClientTuning,
  type FetchTrigger,
  type ForcedState,
  type PolicySnapshot,
} from './client-policy';

/**
 * App-policy state for the gate above the router (A01/Q31). Sources, newest wins: the cached policy (secure storage,
 * installation-scoped), the latest `GET /v1/app/config`, and any 426 / 503-maintenance refusal seen on ANY API call
 * (reported by the HTTP observer). A successful config fetch replaces forced states with the server's current answer.
 * Offline without a cached policy ⇒ OK (the server enforces on the next call). Nothing here authorises anything.
 */
export interface AppPolicyDeps {
  readonly fetchConfig: () => Promise<AppConfig>;
  readonly store: KeyValueStore;
  readonly build: number | null;
  readonly now?: () => number;
}

export interface AppPolicyState {
  readonly view: ClientPolicyView;
  readonly snapshot: PolicySnapshot | null;
  readonly tuning: ClientTuning;
  /** A config fetch is running (the blocking screens show "Checking…" on their retry button). */
  readonly checking: boolean;
  /** Consecutive automatic maintenance re-checks (drives the 30 s → 5 min backoff). */
  readonly maintenanceAttempt: number;
}

export class AppPolicyStore {
  private snapshot: PolicySnapshot | null = null;
  private forced: ForcedState = null;
  private softDismissedAt: number | null = null;
  private lastFetchAt: number | null = null;
  private checking = false;
  private maintenanceAttempt = 0;
  private state: AppPolicyState;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(private readonly deps: AppPolicyDeps) {
    this.now = deps.now ?? Date.now;
    this.state = this.compute();
  }

  getState = (): AppPolicyState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Restores the cached policy at start-up. Unreadable storage is treated as "no cached policy". */
  async load(): Promise<void> {
    const cached = parseCachedPolicy(await this.deps.store.getItem(STORAGE_KEYS.appPolicy).catch(() => null));
    if (cached !== null) {
      this.snapshot = cached.snapshot;
      this.softDismissedAt = cached.softDismissedAt;
    }
    this.emit();
  }

  /** Fetches the policy on start, on foreground (≤ once per 15 min) and on explicit/automatic retries. */
  async refresh(trigger: FetchTrigger): Promise<void> {
    const now = this.now();
    if (this.checking || !shouldFetchPolicy(trigger, this.lastFetchAt, now)) return;
    this.checking = true;
    this.emit();
    try {
      const config = await this.deps.fetchConfig();
      this.snapshot = snapshotOf(config);
      this.forced = null;
      this.lastFetchAt = this.now();
      // The fresh policy applies in memory even if it cannot be cached; the next start then fetches again.
      await this.persist().catch(() => undefined);
    } catch (error) {
      // Offline/unavailable keeps the last known policy; a refusal of the config call itself is honoured.
      this.applyRefusal(error);
    } finally {
      this.checking = false;
      this.maintenanceAttempt = this.compute().view.kind === 'maintenance' && trigger === 'retry' ? this.maintenanceAttempt + 1 : 0;
      this.emit();
    }
  }

  /** HTTP-observer hook: a 426 or a maintenance 503 on any call flips the gate immediately. */
  report(error: ApiError | null): void {
    if (error === null) return;
    if (this.applyRefusal(error)) this.emit();
  }

  dismissSoftUpdate(): void {
    this.softDismissedAt = this.now();
    this.emit();
    // Remembering the dismissal is a convenience: the banner simply shows again if it could not be stored.
    this.persist().catch(() => undefined);
  }

  private applyRefusal(error: unknown): boolean {
    const kind = error instanceof ApiError ? error.kind : null;
    if (kind === 'update-required' && this.forced !== 'UPDATE_REQUIRED') {
      this.forced = 'UPDATE_REQUIRED';
      return true;
    }
    if (kind === 'maintenance' && this.forced === null) {
      this.forced = 'MAINTENANCE';
      return true;
    }
    return false;
  }

  private persist(): Promise<void> {
    const cached: CachedPolicy = { v: 1, savedAt: this.now(), snapshot: this.snapshot, softDismissedAt: this.softDismissedAt };
    return this.deps.store.setItem(STORAGE_KEYS.appPolicy, JSON.stringify(cached));
  }

  private compute(): AppPolicyState {
    return {
      view: evaluateClientPolicy({
        snapshot: this.snapshot,
        build: this.deps.build,
        forced: this.forced,
        softDismissedAt: this.softDismissedAt,
        now: this.now(),
      }),
      snapshot: this.snapshot,
      tuning: tuningOf(this.snapshot),
      checking: this.checking,
      maintenanceAttempt: this.maintenanceAttempt,
    };
  }

  private emit(): void {
    this.state = this.compute();
    for (const listener of this.listeners) listener();
  }
}
