import { SessionTokensSchema, type SessionTokens } from '@wayvro/contracts';
import { z } from 'zod';
import { ApiError } from '../api/errors';
import { STORAGE_KEYS, type KeyValueStore } from './key-value-store';

/**
 * Client session lifecycle (Q01, docs/phase2/PHASE2_AUTH_SESSION_DESIGN.md §4):
 *
 *  - Tokens live ONLY in secure storage (via KeyValueStore) and in this object's memory.
 *  - Refresh is SINGLE-FLIGHT: concurrent 401s share one refresh call.
 *  - Refresh tokens are single-use and reuse revokes the session — except when the SAME idempotency key repeats within
 *    the server's replay window. The key is therefore persisted together with the refresh token BEFORE the request is
 *    sent, reused for every retry (also after an app restart) and cleared only with the new token pair.
 *  - The new pair is persisted BEFORE waiters are released, so no caller can observe tokens that a crash would lose.
 *  - Any definitive refusal of the refresh ⇒ session expired ⇒ local wipe (tokens + installation-scoped data; the
 *    installation id is kept).
 *
 * Routing never relies on this state alone: once signed in, the server's account state decides what the user sees.
 */

const StoredSessionSchema = SessionTokensSchema.extend({
  v: z.literal(1),
  /** Idempotency key of a refresh whose outcome is unknown (null when none is pending). */
  pendingRefreshKey: z.string().nullable(),
});
type StoredSession = z.infer<typeof StoredSessionSchema>;

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out'; readonly reason: 'none' | 'signed-out' | 'expired' }
  | { readonly status: 'signed-in'; readonly sessionId: string };

/** @internal exported for unit tests (the app wires createRefreshCall). */
export type RefreshCall = (refreshToken: string, idempotencyKey: string) => Promise<SessionTokens>;

export interface SessionManagerDeps {
  readonly store: KeyValueStore;
  readonly refreshCall: RefreshCall;
  readonly newIdempotencyKey: () => string;
}

export type RefreshOutcome = 'refreshed' | 'expired';

export class SessionManager {
  private stored: StoredSession | null = null;
  private state: SessionState = { status: 'loading' };
  private inflight: Promise<RefreshOutcome> | null = null;
  /** Set by the first `refreshDueAtFirstUse` call of this process (the check runs at most once). */
  private firstUseChecked = false;
  /** Incremented by every establish/clear so a refresh that finishes after a sign-out cannot resurrect tokens. */
  private generation = 0;
  /** Session-storage writes run one at a time; a write queued under an older generation is skipped. */
  private writes: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly wipers = new Set<() => Promise<void> | void>();

  constructor(private readonly deps: SessionManagerDeps) {}

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Registers installation-scoped data to wipe on sign-out/expiry (idempotency intents, query cache, flow state). */
  onWipe(wiper: () => Promise<void> | void): void {
    this.wipers.add(wiper);
  }

  accessToken(): string | null {
    return this.stored?.accessToken ?? null;
  }

  /** Reads the persisted session at start-up. Corrupt or foreign-shaped data is wiped (fail closed). */
  async load(): Promise<void> {
    const raw = await this.deps.store.getItem(STORAGE_KEYS.session);
    let parsed: StoredSession | null = null;
    if (raw !== null) {
      try {
        const result = StoredSessionSchema.safeParse(JSON.parse(raw));
        parsed = result.success ? result.data : null;
      } catch {
        parsed = null;
      }
      if (parsed === null) await this.deps.store.deleteItem(STORAGE_KEYS.session);
    }
    this.stored = parsed;
    this.setState(parsed ? { status: 'signed-in', sessionId: parsed.sessionId } : { status: 'signed-out', reason: 'none' });
  }

  /** Stores a freshly created session (after OTP verification). */
  async establish(tokens: SessionTokens): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    const next: StoredSession = { ...pickTokens(tokens), v: 1, pendingRefreshKey: null };
    if (!(await this.persistIfCurrent(next, generation)) || generation !== this.generation) return;
    this.stored = next;
    this.setState({ status: 'signed-in', sessionId: next.sessionId });
  }

  /**
   * Replaces the session with one for ANOTHER account (P2.9 dormant-number review: "I'm new"). The new token pair
   * overwrites the stored session in one write; then every installation-scoped wiper runs (idempotency intents, query
   * cache, flow state, local evidence), so nothing of the previous account remains on this phone.
   */
  async switchAccount(tokens: SessionTokens): Promise<{ readonly complete: boolean }> {
    await this.establish(tokens);
    let complete = true;
    for (const wiper of this.wipers) {
      try {
        await wiper();
      } catch {
        complete = false;
      }
    }
    return { complete };
  }

  /**
   * SP02-F1 cold-start shortcut: true AT MOST ONCE per process — on the first authenticated call — when the stored access
   * token's server-issued expiry (`accessTokenExpiresAt`) has already passed at `nowMs`. The caller then refreshes
   * through `refreshAfterUnauthorized` (the same single-flight, persisted-idempotency-key refresh) BEFORE sending, instead
   * of first sending a request that can only answer 401. `nowMs` is a hint (device clock plus the learnt server offset):
   * a wrong clock costs at most one spare refresh per process or falls back to the unchanged 401 path; token lifetimes,
   * rotation, replay protection and every server check stay as they are.
   */
  refreshDueAtFirstUse(nowMs: number): boolean {
    if (this.firstUseChecked || this.stored === null) return false;
    this.firstUseChecked = true;
    const expiresAt = Date.parse(this.stored.accessTokenExpiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= nowMs;
  }

  /**
   * Called after a 401 with `staleAccessToken`. Resolves 'refreshed' when a newer access token is available (either
   * from this call or because another caller already rotated it), 'expired' when the session is gone. Throws ApiError
   * for transient failures (offline/rate-limited/unavailable): tokens and the pending key are kept for a later retry.
   */
  refreshAfterUnauthorized(staleAccessToken: string): Promise<RefreshOutcome> {
    if (this.stored === null) return Promise.resolve('expired');
    if (this.stored.accessToken !== staleAccessToken) return Promise.resolve('refreshed');
    if (this.inflight) return this.inflight;
    const run: Promise<RefreshOutcome> = this.runRefresh().finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async runRefresh(): Promise<RefreshOutcome> {
    const generation = this.generation;
    const current = this.stored;
    if (current === null) return 'expired';

    let key = current.pendingRefreshKey;
    if (key === null) {
      key = this.deps.newIdempotencyKey();
      const pending: StoredSession = { ...current, pendingRefreshKey: key };
      if (!(await this.persistIfCurrent(pending, generation)) || generation !== this.generation) return 'expired';
      this.stored = pending;
    }

    let tokens: SessionTokens;
    try {
      tokens = await this.deps.refreshCall(current.refreshToken, key);
    } catch (error) {
      if (generation !== this.generation) return 'expired';
      if (error instanceof ApiError && (error.detail.transient || error.kind === 'rate-limited' || error.kind === 'offline')) throw error;
      // A definitive refusal (401 revoked/expired/reused, malformed token, …): the session cannot be recovered.
      await this.clear('expired');
      return 'expired';
    }
    if (generation !== this.generation) return 'expired';
    const next: StoredSession = { ...pickTokens(tokens), v: 1, pendingRefreshKey: null };
    // Persist BEFORE releasing waiters: a crash after this point still has the only valid refresh token.
    if (!(await this.persistIfCurrent(next, generation)) || generation !== this.generation) return 'expired';
    this.stored = next;
    this.setState({ status: 'signed-in', sessionId: next.sessionId });
    return 'refreshed';
  }

  /**
   * Wipes the local session and installation-scoped data. Every wiper runs even if an earlier one fails; the result
   * reports whether the wipe was complete (tokens are dropped from memory first in any case).
   */
  async clear(reason: 'signed-out' | 'expired'): Promise<{ readonly complete: boolean }> {
    this.generation += 1;
    this.stored = null;
    this.inflight = null;
    let complete = true;
    // Queued behind any in-progress session write, so nothing written for the old generation survives the wipe.
    const steps: (() => Promise<void> | void)[] = [() => this.serial(() => this.deps.store.deleteItem(STORAGE_KEYS.session)), ...this.wipers];
    for (const step of steps) {
      try {
        await step();
      } catch {
        complete = false;
      }
    }
    this.setState({ status: 'signed-out', reason });
    return { complete };
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** Writes the session unless a sign-out/expiry/new sign-in happened since `generation`; resolves whether it wrote. */
  private persistIfCurrent(session: StoredSession, generation: number): Promise<boolean> {
    return this.serial(async () => {
      if (generation !== this.generation) return false;
      await this.deps.store.setItem(STORAGE_KEYS.session, JSON.stringify(session));
      return true;
    });
  }

  private setState(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

function pickTokens(t: SessionTokens): SessionTokens {
  return {
    sessionId: t.sessionId,
    accessToken: t.accessToken,
    accessTokenExpiresAt: t.accessTokenExpiresAt,
    refreshToken: t.refreshToken,
    refreshTokenExpiresAt: t.refreshTokenExpiresAt,
  };
}
