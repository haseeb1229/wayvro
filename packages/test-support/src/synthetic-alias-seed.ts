/**
 * Synthetic landmark-alias seed — DEVELOPMENT/TEST ONLY (A06; ADR-045; FA-12 synthetic data). Part of the local
 * synthetic seed path (`pnpm seed:synthetic` runs it after the catalog seed) and usable by integration tests.
 *
 * Same refusals as the catalog seed: WAYVRO_ENV must be `local`/`test`, the database host must be a loopback host, and
 * the database must hold no NON-synthetic configuration. Writes only PROPOSED aliases (the database itself refuses any
 * other starting status); activation is the staff maker-checker flow (approver ≠ creator). The creator is an inert,
 * OFFBOARDED synthetic staff row with no credential (it can never sign in or approve). The alias `source` is FOUNDER
 * because the schema has no synthetic source value; the proposer row and the fixed ids mark them as synthetic.
 * Idempotent: fixed ids, `on conflict do nothing` — a re-run never reverts an approval or a retirement.
 */
import pg from 'pg';
import { SYNTHETIC_CATALOG, assertSyntheticSeedAllowed, nonSyntheticConfiguration } from './synthetic-catalog-seed.js';
import { SYNTHETIC_ALIAS_PROPOSER, SYNTHETIC_LANDMARK_ALIASES } from './synthetic-landmark-aliases.js';

export interface SyntheticAliasSeedOptions {
  readonly env: string | undefined;
  readonly databaseUrl: string;
  readonly log?: (line: string) => void;
}

export interface SyntheticAliasSeedResult {
  /** Aliases inserted by this run (0 on a re-run). */
  readonly inserted: number;
  readonly total: number;
}

export async function seedSyntheticLandmarkAliases(options: SyntheticAliasSeedOptions): Promise<SyntheticAliasSeedResult> {
  assertSyntheticSeedAllowed(options.env, options.databaseUrl);
  const log = options.log ?? (() => undefined);
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    if (!(await client.query<{ t: string | null }>(`select to_regclass('geo.landmark_aliases')::text t`)).rows[0]?.t)
      throw new Error('synthetic alias seed refused: geo.landmark_aliases does not exist (run the migrations first)');
    const real = await nonSyntheticConfiguration(client);
    if (real.length > 0) throw new Error(`synthetic alias seed refused: non-synthetic configuration exists in ${real.join(', ')}`);

    const P = SYNTHETIC_ALIAS_PROPOSER;
    const proposer = (
      await client.query<{ status: string; display_name: string }>(`select status, display_name from staff.staff_accounts where id = $1`, [P.staffId])
    ).rows[0];
    if (proposer && (proposer.status !== 'OFFBOARDED' || proposer.display_name !== P.displayName))
      throw new Error('synthetic alias seed refused: the synthetic proposer id belongs to another staff account');
    if (!proposer) {
      log(`staff ${P.staffId} (synthetic alias proposer, OFFBOARDED, no credential)`);
      await client.query(`insert into staff.staff_accounts (id, display_name, work_email, status, offboarded_at) values ($1, $2, $3, 'OFFBOARDED', now())`, [
        P.staffId,
        P.displayName,
        P.workEmail,
      ]);
    }

    let inserted = 0;
    for (const a of SYNTHETIC_LANDMARK_ALIASES) {
      const r = await client.query(
        `insert into geo.landmark_aliases (id, city_code, locale, alias_normalised, alias_display, canonical_query, source, status, created_by_staff_id)
         values ($1, $2, $3, $4, $4, $5, 'FOUNDER', 'PROPOSED', $6)
         on conflict (id) do nothing`,
        [a.id, SYNTHETIC_CATALOG.cityCode, a.locale, a.alias, a.canonical, P.staffId],
      );
      inserted += r.rowCount ?? 0;
    }
    log(
      `landmark aliases ${SYNTHETIC_CATALOG.cityCode}: ${String(inserted)} new of ${String(SYNTHETIC_LANDMARK_ALIASES.length)} synthetic (PROPOSED; activation needs staff maker-checker)`,
    );
    await client.query('commit');
    return { inserted, total: SYNTHETIC_LANDMARK_ALIASES.length };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}
