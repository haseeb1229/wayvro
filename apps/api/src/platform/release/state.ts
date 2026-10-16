/**
 * In-process cache of the release-control state (ACTIVE version policies with their blocked ranges + every runtime
 * switch row), read in one round trip and refreshed at most every RUNTIME_SWITCH_CACHE_SECONDS (default 10 s): the
 * staff UI states "takes effect within 10 s". Correctness never depends on outbox events (ADR-049).
 *
 * Failure handling (documented fail-open, PHASE3_SECURITY_COST_THREAT_MODEL §5 item 16): the cache never throws. When
 * the store is unreachable it keeps serving the last-known snapshot (flagged stale) or, if nothing was ever loaded,
 * the empty snapshot = no ACTIVE policy (no update enforcement) and registry defaults for every switch (sensitive
 * capabilities default OFF in the registry). Refresh attempts are bounded to one per TTL (no retry storm) and
 * single-flight per process.
 */
import type { AppPlatform, BlockedBuildReason, SwitchScope, SwitchState } from '@wayvro/config';
import type { Logger } from '@wayvro/observability';
import type { Queryable } from '@wayvro/server-runtime';
import type { ActiveAppPolicy } from './policy.js';

/** One stored switch row (current state of a key/scope/city target). */
export interface SwitchRowState {
  readonly id: string;
  readonly key: string;
  readonly scope: SwitchScope;
  readonly cityCode: string | null;
  readonly state: SwitchState;
  readonly messageKey: string | null;
  readonly expectedEnd: Date | null;
}

export interface ReleaseSnapshot {
  readonly policies: ReadonlyMap<AppPlatform, ActiveAppPolicy>;
  readonly switches: readonly SwitchRowState[];
  /** Epoch ms of the load this snapshot came from; null = never loaded (defaults only). */
  readonly loadedAt: number | null;
  /** True when the latest refresh attempt failed (the snapshot is the last-known one or the defaults). */
  readonly stale: boolean;
}

const EMPTY: ReleaseSnapshot = { policies: new Map(), switches: [], loadedAt: null, stale: true };

interface PolicyRow {
  id: string;
  platform: AppPlatform;
  version: number;
  min_supported_build: number;
  recommended_build: number;
  store_url_key: string | null;
  soft_message_key: string;
  hard_message_key: string;
  ranges: Array<{ lower: number; upper: number; reason: BlockedBuildReason }>;
}
interface SwitchRow {
  id: string;
  key: string;
  scope: SwitchScope;
  city_code: string | null;
  state: SwitchState;
  message_key: string | null;
  expected_end: Date | null;
}

export interface ReleaseStateOptions {
  readonly ttlMs: number;
  readonly log: Logger;
  /** Injected clock (tests); defaults to Date.now. */
  readonly now?: () => number;
}

export class ReleaseStateCache {
  private snapshot: ReleaseSnapshot = EMPTY;
  private nextRefreshAt = 0;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(
    private readonly db: Queryable,
    private readonly options: ReleaseStateOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * The current snapshot, refreshed when the TTL elapsed. Never throws. A caller arriving while a refresh is in flight
   * waits for that refresh too: `refresh()` moves `nextRefreshAt` forward before its query returns, so without this a
   * concurrent caller was answered from the snapshot being replaced — however old it was — and two reads of one
   * moment could disagree (SP-08 MAINT-01: `GET /v1/app/config` said "no maintenance" while the enforcement hook
   * answered the parallel account-state call with 503, so the app showed a generic error instead of the
   * maintenance screen).
   */
  async get(): Promise<ReleaseSnapshot> {
    if (this.now() >= this.nextRefreshAt) {
      this.inflight ??= this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    if (this.inflight !== null) await this.inflight;
    return this.snapshot;
  }

  /** Forces the next `get()` to reload (called after a local staff change so this process applies it at once). */
  invalidate(): void {
    this.nextRefreshAt = 0;
  }

  private async refresh(): Promise<void> {
    this.nextRefreshAt = this.now() + this.options.ttlMs;
    try {
      const [policies, switches] = await Promise.all([
        this.db.query<PolicyRow>(
          `select p.id, p.platform, p.version, p.min_supported_build, p.recommended_build, p.store_url_key, p.soft_message_key, p.hard_message_key,
                  coalesce(json_agg(json_build_object('lower', lower(b.builds), 'upper', upper(b.builds), 'reason', b.reason_code) order by lower(b.builds))
                           filter (where b.policy_id is not null), '[]'::json) ranges
             from platform.app_version_policies p left join platform.app_blocked_builds b on b.policy_id = p.id
            where p.status = 'ACTIVE' group by p.id`,
        ),
        this.db.query<SwitchRow>(`select id, key, scope, city_code, state, message_key, expected_end from platform.runtime_switches`),
      ]);
      this.snapshot = {
        policies: new Map(
          policies.rows.map((p) => [
            p.platform,
            {
              id: p.id,
              platform: p.platform,
              version: p.version,
              minSupportedBuild: p.min_supported_build,
              recommendedBuild: p.recommended_build,
              storeUrlKey: p.store_url_key,
              softMessageKey: p.soft_message_key,
              hardMessageKey: p.hard_message_key,
              // int4range is canonical [lower, upper): inclusive upper = upper - 1
              blockedRanges: p.ranges.map((r) => ({ fromBuild: r.lower, toBuild: r.upper - 1, reasonCode: r.reason })),
            },
          ]),
        ),
        switches: switches.rows.map((s) => ({
          id: s.id,
          key: s.key,
          scope: s.scope,
          cityCode: s.city_code,
          state: s.state,
          messageKey: s.message_key,
          expectedEnd: s.expected_end,
        })),
        loadedAt: this.now(),
        stale: false,
      };
    } catch (e) {
      this.snapshot = { ...this.snapshot, stale: true };
      this.options.log.warn(
        { err: e, signal: 'RELEASE_STATE_UNAVAILABLE', lastLoadedAt: this.snapshot.loadedAt === null ? null : new Date(this.snapshot.loadedAt).toISOString() },
        this.snapshot.loadedAt === null
          ? 'release-control store unreachable: serving registry defaults and no version policy (documented fail-open)'
          : 'release-control store unreachable: serving the last-known state',
      );
    }
  }
}
