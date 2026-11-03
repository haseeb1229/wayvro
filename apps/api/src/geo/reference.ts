/**
 * Read-mostly reference data for the geo gateway, cached in-process for 60 s (configuration changes take effect within
 * a minute; correctness never depends on events): ENABLED cities (`catalog.cities`, Phase 2) and ACTIVE landmark
 * aliases (`geo.landmark_aliases`). Alias expansion is an exact match of the normalised query (A06 search hook); the
 * canonical query is normalised the same way before it reaches the provider.
 */
import type { Queryable } from '@wayvro/server-runtime';
import { normaliseQuery } from './normalise.js';

const TTL_MS = 60_000;

export class GeoReference {
  private readonly cities = new Map<string, { at: number; enabled: boolean }>();
  private readonly aliases = new Map<string, { at: number; map: ReadonlyMap<string, string> }>();

  constructor(
    private readonly db: Queryable,
    private readonly now: () => number = Date.now,
  ) {}

  async cityEnabled(cityCode: string): Promise<boolean> {
    const hit = this.cities.get(cityCode);
    if (hit && this.now() - hit.at < TTL_MS) return hit.enabled;
    const r = await this.db.query<{ status: string }>(`select status from catalog.cities where code = $1`, [cityCode]);
    const enabled = r.rows[0]?.status === 'ENABLED';
    this.cities.set(cityCode, { at: this.now(), enabled });
    return enabled;
  }

  /** The canonical query for an ACTIVE alias of (city, locale), or the query itself. */
  async expand(cityCode: string, locale: string, normalisedQuery: string): Promise<string> {
    const id = `${cityCode}|${locale}`;
    let entry = this.aliases.get(id);
    if (!entry || this.now() - entry.at >= TTL_MS) {
      const r = await this.db.query<{ alias_normalised: string; canonical_query: string }>(
        `select alias_normalised, canonical_query from geo.landmark_aliases where city_code = $1 and locale = $2 and status = 'ACTIVE'`,
        [cityCode, locale],
      );
      entry = { at: this.now(), map: new Map(r.rows.map((a) => [a.alias_normalised, normaliseQuery(a.canonical_query)])) };
      this.aliases.set(id, entry);
    }
    return entry.map.get(normalisedQuery) ?? normalisedQuery;
  }

  /** Staff changes in this process take effect immediately (other processes within the 60 s TTL). */
  invalidateAliases(): void {
    this.aliases.clear();
  }
}
