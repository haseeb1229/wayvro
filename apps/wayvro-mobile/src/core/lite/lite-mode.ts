import { z } from 'zod';
import type { HttpObservation } from '../api/http';
import { STORAGE_KEYS, type KeyValueStore } from '../session/key-value-store';

/**
 * Lite mode (L08; ADR-019): one app, a lighter way of using it on weak networks — text-first screens, `detail=lite`
 * quotes (no polyline), slower/longer search triggers, no automatic quote refresh and visible data age. It is turned on
 * by the rider (manual toggle) and only ever SUGGESTED automatically: when 3 of the last 5 API calls took longer than
 * 4 s or timed out (values from GET /v1/app/config), measured in the HTTP layer — NetInfo is not installed. Lite never
 * hides safety/legal text or error reasons.
 */

/** Samples the heuristic looks at (the last N completed API attempts). @internal exported for unit tests */
export const LITE_WINDOW = 5;
const LITE_MIN_CHARS = 4;
const LITE_DEBOUNCE_MS = 500;

export interface LiteThresholds {
  readonly slowRequestMs: number;
  readonly suggestAfterSlowRequests: number;
}

/**
 * Whether one attempt counts as slow: a response slower than the threshold, or the app-side timeout. Cancelled
 * requests (superseded searches) and instant network failures (no connection — offline is a different state) are not
 * samples. @returns null when the attempt is not a sample
 * @internal exported for unit tests
 */
export function slowSample(observation: Pick<HttpObservation, 'durationMs' | 'outcome'>, slowRequestMs: number): boolean | null {
  switch (observation.outcome) {
    case 'cancelled':
    case 'network':
      return null;
    case 'timeout':
      return true;
    case 'response':
      return observation.durationMs > slowRequestMs;
  }
}

/** Appends a sample and keeps the last LITE_WINDOW. @internal exported for unit tests */
export function pushSample(window: readonly boolean[], slow: boolean): readonly boolean[] {
  return [...window, slow].slice(-LITE_WINDOW);
}

/** @internal exported for unit tests */
export function shouldSuggestLite(window: readonly boolean[], threshold: number): boolean {
  return window.filter(Boolean).length >= threshold;
}

/** Search trigger tuning: the server's values, made lighter (never heavier) in Lite mode. */
export function searchTuning(
  lite: boolean,
  base: { readonly minChars: number; readonly debounceMs: number },
): { readonly minChars: number; readonly debounceMs: number } {
  return lite ? { minChars: Math.max(LITE_MIN_CHARS, base.minChars), debounceMs: Math.max(LITE_DEBOUNCE_MS, base.debounceMs) } : base;
}

/** `detail` query of quote calls. */
export const quoteDetail = (lite: boolean): 'lite' | 'full' => (lite ? 'lite' : 'full');

/** Account data older than this shows its age (UX doc §11). @internal exported for unit tests */
export const ACCOUNT_STALE_MS = 5 * 60 * 1000;

/** @internal exported for unit tests */
export function isStale(updatedAt: number, now: number, thresholdMs: number): boolean {
  return now - updatedAt > thresholdMs;
}

const StoredLiteSchema = z.object({ v: z.literal(1), enabled: z.boolean() });

function storedLiteEnabled(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const parsed = StoredLiteSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.enabled;
  } catch {
    return false;
  }
}

export interface LiteState {
  readonly enabled: boolean;
  /** The heuristic suggests Lite and the rider has not dismissed the suggestion in this session. */
  readonly suggested: boolean;
}

/**
 * Lite preference (`wayvro.lite-mode.v1`, installation-scoped like the UI language, kept on sign-out) and the timing
 * window. The suggestion is in memory only and never switches Lite on by itself.
 */
export class LiteModeStore {
  private enabled = false;
  private window: readonly boolean[] = [];
  private dismissed = false;
  private state: LiteState = { enabled: false, suggested: false };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly thresholds: () => LiteThresholds,
  ) {}

  getState = (): LiteState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Unreadable storage or foreign-shaped data means Lite off (the default). */
  async load(): Promise<void> {
    const raw = await this.store.getItem(STORAGE_KEYS.liteMode).catch(() => null);
    this.enabled = storedLiteEnabled(raw);
    this.emit();
  }

  /** HTTP-observer hook (timing and outcome only). */
  record(observation: Pick<HttpObservation, 'durationMs' | 'outcome'>): void {
    const { slowRequestMs } = this.thresholds();
    const slow = slowSample(observation, slowRequestMs);
    if (slow === null) return;
    this.window = pushSample(this.window, slow);
    this.emit();
  }

  /** Turns Lite on/off; resolves false when the choice could not be remembered (it applies in memory either way). */
  async setEnabled(enabled: boolean): Promise<boolean> {
    this.enabled = enabled;
    this.dismissed = true;
    this.emit();
    try {
      await this.store.setItem(STORAGE_KEYS.liteMode, JSON.stringify({ v: 1, enabled }));
      return true;
    } catch {
      return false;
    }
  }

  dismissSuggestion(): void {
    this.dismissed = true;
    this.emit();
  }

  private emit(): void {
    const suggested = !this.enabled && !this.dismissed && shouldSuggestLite(this.window, this.thresholds().suggestAfterSlowRequests);
    if (this.state.enabled !== this.enabled || this.state.suggested !== suggested) this.state = { enabled: this.enabled, suggested };
    for (const listener of this.listeners) listener();
  }
}
