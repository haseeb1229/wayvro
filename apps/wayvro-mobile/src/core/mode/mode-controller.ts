import type { KeyValueStore } from '../session/key-value-store';
import { driverHomeAvailable, type AppMode, type ModeAvailability, type ModeHome } from './availability';
import {
  forgetLastQuote,
  loadLastQuote,
  loadModePreference,
  saveLastQuote,
  saveModePreference,
  wipeModeRecords,
  type LastQuote,
  type ModePreference,
} from './persisted';

/**
 * ModeController (V08; ADR-048; UX doc §4). Holds the persisted mode PREFERENCE (a hint bound to the account id), the
 * last quote-group record and a one-line notice for the next mode home. It never caches capability, eligibility,
 * restriction or KYC state, never authorises anything and sends no mode header: every launch re-derives availability
 * from GET /v1/account/state and every driver endpoint is re-checked by the server.
 */

/** One-line explanation shown on the home the app fell back to. */
export type ModeNotice =
  | 'DRIVER_AREA_UNAVAILABLE'
  | 'RIDER_UNAVAILABLE'
  /** An intent switched the mode visibly ("Opened Driver/Partner area"). */
  | 'OPENED_DRIVER_AREA'
  /** An intent was refused (unknown, malformed, mode not available, restricted). */
  | 'LINK_UNAVAILABLE';

/** The decision of a mode switch, computed on FRESH server state (switchTo refetches the account state first). */
export type SwitchPlan =
  | { readonly kind: 'replace'; readonly href: ModeHome; readonly persist: AppMode }
  /** No driver profile yet: the Driver/Partner onboarding opens on top; the preference stays RIDER. */
  | { readonly kind: 'push'; readonly href: '/earn' }
  | { readonly kind: 'stay'; readonly notice: ModeNotice };

/**
 * Phase-3 switch matrix (UX doc §4.3/§4.4). Phase 4 extension point (documented, no code now): a driver who is ONLINE
 * must go offline first, and an active driver obligation refuses the switch (DRIVER_OBLIGATION_ACTIVE, INV-06).
 */
export function planSwitch(target: AppMode, availability: ModeAvailability): SwitchPlan {
  if (target === 'RIDER')
    return availability.rider.available ? { kind: 'replace', href: '/ride', persist: 'RIDER' } : { kind: 'stay', notice: 'RIDER_UNAVAILABLE' };
  if (driverHomeAvailable(availability)) return { kind: 'replace', href: '/drive', persist: 'DRIVER' };
  if (availability.driver.entry === 'ONBOARDING' && availability.driver.available) return { kind: 'push', href: '/earn' };
  return { kind: 'stay', notice: 'DRIVER_AREA_UNAVAILABLE' };
}

/**
 * Guard of every `/drive/*` route (T3-18): re-checked on focus and on restore. Without a driver home the app replaces
 * the route with the Rider home and explains why; it never shows cached driver content.
 */
export function driveGuard(availability: ModeAvailability): { readonly allowed: true } | { readonly allowed: false; readonly notice: ModeNotice } {
  return driverHomeAvailable(availability) ? { allowed: true } : { allowed: false, notice: 'DRIVER_AREA_UNAVAILABLE' };
}

export interface ModeControllerState {
  readonly loaded: boolean;
  readonly preference: ModePreference | null;
  readonly lastQuote: LastQuote | null;
  readonly notice: ModeNotice | null;
}

export class ModeController {
  private state: ModeControllerState = { loaded: false, preference: null, lastQuote: null, notice: null };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): ModeControllerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async load(): Promise<void> {
    const [preference, lastQuote] = await Promise.all([loadModePreference(this.store), loadLastQuote(this.store)]);
    this.set({ loaded: true, preference, lastQuote });
  }

  /** Persists the preference for this account (a hint: a different account on this phone ignores it). */
  async setPreference(accountId: string, mode: AppMode): Promise<void> {
    const preference: ModePreference = { v: 1, accountId, mode, savedAt: this.now() };
    this.set({ preference });
    await saveModePreference(this.store, preference);
  }

  /** Remembers the latest quote group (id + server expiry only) for restoration after a restart. */
  async rememberQuote(quoteGroupId: string, expiresAt: string): Promise<void> {
    const lastQuote: LastQuote = { v: 1, quoteGroupId, expiresAt, savedAt: this.now() };
    this.set({ lastQuote });
    await saveLastQuote(this.store, lastQuote);
  }

  /** Forgets a quote group the server no longer returns to this account (404/403) — silently, per UX doc §6. */
  async forgetQuote(): Promise<void> {
    this.set({ lastQuote: null });
    await forgetLastQuote(this.store);
  }

  setNotice(notice: ModeNotice | null): void {
    this.set({ notice });
  }

  /** Sign-out / session expiry: memory first, then storage. */
  async wipe(): Promise<void> {
    this.set({ preference: null, lastQuote: null, notice: null });
    await wipeModeRecords(this.store);
  }

  private set(patch: Partial<ModeControllerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
