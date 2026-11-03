import type { AutocompleteResult } from '@wayvro/contracts';
import { toApiError } from '../../../core/api/errors';
import { isRequestCancelled } from '../../../core/api/http';

/**
 * Where-to search (B02; UX doc §8.2). Debounce and minimum length come from GET /v1/app/config (defaults 300 ms / 3;
 * Lite 500 ms / 4). At most ONE request is in flight: a newer query aborts the older one and a sequence number drops
 * any late answer. Typed text and results stay in memory; nothing is logged.
 * @internal exported for unit tests
 */
export type SearchStatus =
  | 'idle'
  | 'too-short'
  | 'waiting'
  | 'loading'
  | 'results'
  | 'empty'
  /** No connection — the pin row and pickup points stay available. */
  | 'offline'
  /** 429 / budget exhausted / provider down / switch off: "type the full address or choose on map". */
  | 'degraded'
  | 'error';

export type Suggestion = AutocompleteResult['suggestions'][number];

export interface SearchState {
  readonly query: string;
  readonly mode: 'SUGGEST' | 'GEOCODE';
  readonly status: SearchStatus;
  readonly suggestions: readonly Suggestion[];
  /** The server served cached suggestions after a provider problem (no provider name is ever shown). */
  readonly stale: boolean;
}

/** Per-call context (tuning plus whatever the request needs: field session, bias, locale). */
export interface SearchTuning {
  readonly minChars: number;
  readonly debounceMs: number;
}

export interface SearchDeps<C extends SearchTuning> {
  readonly autocomplete: (q: string, mode: 'SUGGEST' | 'GEOCODE', signal: AbortSignal, context: C) => Promise<AutocompleteResult>;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

const DEGRADED_REASONS: ReadonlySet<string> = new Set(['GEO_BUDGET_EXHAUSTED', 'GEO_PROVIDER_UNAVAILABLE']);

/** Maps a failed search to its state (pure). @internal exported for unit tests */
export function searchFailure(error: unknown): Extract<SearchStatus, 'offline' | 'degraded' | 'error'> {
  const apiError = toApiError(error);
  if (apiError.kind === 'offline') return 'offline';
  if (apiError.kind === 'rate-limited' || apiError.kind === 'feature-disabled') return 'degraded';
  if (apiError.kind === 'unavailable' && apiError.detail.reasonCodes.some((c) => DEGRADED_REASONS.has(c))) return 'degraded';
  return 'error';
}

const INITIAL_SEARCH: SearchState = { query: '', mode: 'SUGGEST', status: 'idle', suggestions: [], stale: false };

/**
 * The context travels with each call (the screen passes its current tuning, field session, bias and locale), so the
 * controller never reads screen state behind the screen's back; a debounced run uses the context of its keystroke.
 */
export class SearchController<C extends SearchTuning> {
  private state: SearchState = INITIAL_SEARCH;
  private timer: unknown = null;
  private inflight: AbortController | null = null;
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SearchDeps<C>) {}

  getState = (): SearchState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Typing: cancels the pending timer and the in-flight request, then waits for the debounce. */
  setQuery(query: string, context: C): void {
    this.cancel();
    const trimmed = query.trim();
    if (trimmed.length < context.minChars) {
      this.set({ query, mode: 'SUGGEST', status: trimmed.length === 0 ? 'idle' : 'too-short', suggestions: [], stale: false });
      return;
    }
    this.set({ query, mode: 'SUGGEST', status: 'waiting' });
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run('SUGGEST', context);
    }, context.debounceMs);
  }

  /** "Type the full address": forward geocoding of the typed text, immediately (separate server meter). */
  searchFullAddress(context: C): void {
    if (this.state.query.trim().length < context.minChars) return;
    this.cancel();
    void this.run('GEOCODE', context);
  }

  retry(context: C): void {
    if (this.state.status !== 'offline' && this.state.status !== 'error' && this.state.status !== 'degraded') return;
    this.cancel();
    void this.run(this.state.mode, context);
  }

  /** Screen blur / sign-out: nothing keeps running in the background. */
  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private cancel(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.inflight?.abort();
    this.inflight = null;
    this.seq += 1;
  }

  private async run(mode: 'SUGGEST' | 'GEOCODE', context: C): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const controller = new AbortController();
    this.inflight = controller;
    this.set({ mode, status: 'loading' });
    try {
      const result = await this.deps.autocomplete(this.state.query.trim(), mode, controller.signal, context);
      if (seq !== this.seq) return;
      this.set({
        status: result.suggestions.length === 0 ? 'empty' : 'results',
        suggestions: result.suggestions,
        stale: result.source.cacheStatus === 'STALE_SERVED',
      });
    } catch (error) {
      if (seq !== this.seq || isRequestCancelled(error)) return;
      this.set({ status: searchFailure(error), suggestions: [], stale: false });
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  private set(patch: Partial<SearchState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
