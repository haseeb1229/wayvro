/**
 * Manual-review sheets, written into the git-ignored run folder:
 *  - blind reverse-geocode rating sheet (§5.5): answers per case with candidate labels replaced by random letters;
 *    the founder rates usefulness 0–3 without knowing the vendor; the key stays in a separate local file;
 *  - route review list (§7.1): one row per ROUTE case × routing component, pre-filled with automatic hints, where the
 *    reviewer records NONE / MINOR / CRITICAL (+ class, clearing). A bundle with any unresolved CRITICAL is INELIGIBLE.
 */
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { type ValidationResult, CONSTRAINT_CATEGORIES } from './cases.js';
import { parseCsv, toCsv } from './csv.js';
import { corridorOverlap } from './geo.js';
import type { LegTruth } from './gpx.js';
import type { RunRecord } from './runner.js';

const BLIND_COLUMNS = ['blind_id', 'case_id', 'option', 'name', 'block', 'area', 'city', 'name_urdu', 'answer_status', 'usefulness_0_3'] as const;
const REVIEW_COLUMNS = [
  'case_id',
  'component',
  'category',
  'constraint_case',
  'route_status',
  'auto_hints',
  'classification',
  'critical_class',
  'cleared',
  'clearing_action',
] as const;

const CRITICAL_CLASSES = ['WRONG_WAY', 'PRIVATE_OR_INACCESSIBLE', 'PROHIBITED_OR_CLOSED', 'UNSAFE_OR_IMPOSSIBLE', 'SYSTEMATIC_SEVERE_DEFECT'] as const;
const CLEARING_ACTIONS = ['GROUND_TRUTH_CORRECTED', 'PROVIDER_FIX_RERUN', 'FOUNDER_MITIGATION'] as const;

/** Builds the blind sheet and its key. `shuffle` is injectable for deterministic tests. */
export function blindSheet(run: RunRecord, shuffle: <T>(items: T[]) => T[] = cryptoShuffle): { csv: string; key: Record<string, string> } {
  const rows: string[][] = [[...BLIND_COLUMNS]];
  const key: Record<string, string> = {};
  const byCase = new Map<string, RunRecord['reverse'][number][]>();
  for (const r of run.reverse) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  for (const [caseId, answers] of [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    shuffle([...answers]).forEach((answer, index) => {
      const option = String.fromCharCode(65 + index);
      const blindId = `${caseId}-${option}`;
      key[blindId] = answer.component;
      const p = answer.place;
      const status = answer.errorCode !== null ? 'NO_ANSWER_ERROR (scored 0)' : p === null ? 'NO_ADDRESS (scored 0)' : 'ANSWER';
      rows.push([blindId, caseId, option, p?.name ?? '', p?.block ?? '', p?.area ?? '', p?.city ?? '', p?.nameUrdu ?? '', status, '']);
    });
  }
  return { csv: toCsv(rows), key };
}

function cryptoShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

/** Usefulness per (caseId, component) after un-blinding; unrated answers are absent. Throws on malformed sheets. */
export function readRatings(csv: string, key: Readonly<Record<string, string>>): Map<string, number> {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  if (header.join(',') !== BLIND_COLUMNS.join(',')) throw new Error('rating sheet header does not match the generated blind sheet');
  const out = new Map<string, number>();
  for (const [i, r] of rows.slice(1).entries()) {
    if (r.every((f) => f.trim() === '')) continue;
    const blindId = r[0] ?? '';
    const component = key[blindId];
    if (component === undefined) throw new Error(`rating sheet row ${i + 2}: unknown blind id`);
    const score = (r[9] ?? '').trim();
    if (score === '') continue;
    if (!/^[0-3]$/.test(score)) throw new Error(`rating sheet row ${i + 2}: usefulness must be 0, 1, 2 or 3`);
    out.set(`${r[1] ?? ''}|${component}`, Number(score));
  }
  return out;
}

/** Automatic review hints per `${caseId}|${component}` (priorities for the reviewer, never a classification). */
export function routeHints(run: RunRecord, cases: ValidationResult, truths: ReadonlyMap<string, LegTruth>): Map<string, string[]> {
  const legs = new Map(cases.routes.map((r) => [r.id, r]));
  const out = new Map<string, string[]>();
  for (const r of run.routes) {
    const leg = legs.get(r.caseId);
    const truth = truths.get(r.caseId);
    if (leg === undefined || truth === undefined) continue;
    const hints: string[] = [];
    if (CONSTRAINT_CATEGORIES.has(leg.category)) hints.push('CHECK_CONSTRAINT');
    if (!leg.followedNaturalRoute) hints.push('DIVERTED_LEG');
    if (truth.source === 'ODOMETER') hints.push('NO_GPX');
    if (truth.flagged) hints.push('GPX_ODOMETER_MISMATCH');
    if (r.distanceM !== null && Math.abs(r.distanceM - truth.distanceM) / truth.distanceM > 0.25) hints.push('DISTANCE_ERROR_GT_25PCT');
    const overlap = truth.track === null ? null : corridorOverlap(r.geometry, truth.track);
    if (overlap !== null && overlap < 0.5) hints.push('LOW_CORRIDOR_OVERLAP');
    out.set(`${r.caseId}|${r.component}`, hints);
  }
  return out;
}

/** Route review list with automatic hints (no geometry, no founder text). */
export function reviewSheet(run: RunRecord, cases: ValidationResult, hints: ReadonlyMap<string, readonly string[]>): string {
  const category = new Map(cases.routes.map((r) => [r.id, r.category]));
  const rows: string[][] = [[...REVIEW_COLUMNS]];
  for (const r of run.routes) {
    const cat = category.get(r.caseId) ?? '';
    const routeError = r.errorCode !== null;
    rows.push([
      r.caseId,
      r.component,
      cat,
      CONSTRAINT_CATEGORIES.has(cat) ? 'Y' : 'N',
      routeError ? `ERROR ${r.errorCode}` : 'ROUTE',
      (hints.get(`${r.caseId}|${r.component}`) ?? []).join(' '),
      routeError ? 'NOT_APPLICABLE' : '',
      '',
      '',
      '',
    ]);
  }
  return toCsv(rows);
}

const reviewRow = z
  .object({
    classification: z.enum(['NONE', 'MINOR', 'CRITICAL', 'NOT_APPLICABLE']),
    critical_class: z.union([z.enum(CRITICAL_CLASSES), z.literal('')]),
    cleared: z.enum(['Y', 'N', '']),
    clearing_action: z.union([z.enum(CLEARING_ACTIONS), z.literal('')]),
  })
  .superRefine((v, ctx) => {
    if (v.classification === 'CRITICAL' && v.critical_class === '') ctx.addIssue({ code: 'custom', message: 'CRITICAL needs critical_class' });
    if (v.cleared === 'Y' && v.clearing_action === '') ctx.addIssue({ code: 'custom', message: 'cleared=Y needs a clearing_action (§7.1 a/b/c)' });
  });

export interface ReviewEntry {
  readonly classification: 'NONE' | 'MINOR' | 'CRITICAL' | 'NOT_APPLICABLE';
  readonly criticalClass: (typeof CRITICAL_CLASSES)[number] | null;
  readonly cleared: boolean;
  readonly clearingAction: (typeof CLEARING_ACTIONS)[number] | null;
}

/** Reads the filled review list; rows with an empty classification are "not reviewed" (absent from the map). */
export function readReview(csv: string): Map<string, ReviewEntry> {
  const rows = parseCsv(csv);
  if ((rows[0] ?? []).join(',') !== REVIEW_COLUMNS.join(',')) throw new Error('route review header does not match the generated review list');
  const out = new Map<string, ReviewEntry>();
  for (const [i, r] of rows.slice(1).entries()) {
    if (r.every((f) => f.trim() === '')) continue;
    const classification = (r[6] ?? '').trim();
    if (classification === '') continue;
    const parsed = reviewRow.safeParse({
      classification,
      critical_class: (r[7] ?? '').trim(),
      cleared: (r[8] ?? '').trim(),
      clearing_action: (r[9] ?? '').trim(),
    });
    if (!parsed.success) throw new Error(`route review row ${i + 2}: ${parsed.error.issues.map((x) => x.message).join('; ')}`);
    const v = parsed.data;
    out.set(`${r[0] ?? ''}|${r[1] ?? ''}`, {
      classification: v.classification,
      criticalClass: v.critical_class === '' ? null : v.critical_class,
      cleared: v.cleared === 'Y',
      clearingAction: v.clearing_action === '' ? null : v.clearing_action,
    });
  }
  return out;
}
