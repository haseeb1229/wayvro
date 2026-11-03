/**
 * Service hours (E08; docs/phase3/PHASE3_CATALOG_ZONES_AND_DATA_MODEL.md §3) — pure, server-only, authoritative.
 *
 * Time zone: Asia/Karachi, a fixed UTC+05:00 offset with no daylight saving time (PKT has not observed DST since 2009;
 * the DB pins `timezone = 'Asia/Karachi'`). The instant evaluated is always SERVER time supplied by the caller — a
 * client clock or time zone never reaches this module (T3-30).
 *
 * Rules: a window is `[opens, closes)` in local time on its weekday (0 = Sunday, matching PostgreSQL `EXTRACT(DOW)`);
 * `opens = closes` means the whole day; `closes` may be 24:00; an overnight window is stored as two rows (one per
 * weekday). For a product, its product-specific rows REPLACE the general (product NULL) rows of the zone set entirely;
 * no applicable row means closed (fail closed).
 */
export const KARACHI_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
/** 1970-01-01 (epoch day 0) was a Thursday. */
const EPOCH_WEEKDAY = 4;

export interface ServiceHoursRow {
  /** null = general row (applies to every product without rows of its own). */
  readonly productCode: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekday: number;
  /** Milliseconds after local midnight (0 … 86_400_000). */
  readonly opensMs: number;
  readonly closesMs: number;
}

/** `HH:MM`, `HH:MM:SS` or `HH:MM:SS.ffffff` (PostgreSQL `time` text, including `24:00:00`) → ms after midnight. */
export function parseLocalTime(text: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(text);
  if (!m) throw new RangeError(`invalid local time ${text}`);
  const ms = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3] ?? '0')) * 1000 + Math.floor(Number(`0.${m[4] ?? '0'}`) * 1000);
  if (Number(m[2]) > 59 || Number(m[3] ?? '0') > 59 || ms > DAY_MS) throw new RangeError(`invalid local time ${text}`);
  return ms;
}

/** Local (Asia/Karachi) weekday and milliseconds after local midnight of an instant. */
function karachiLocal(at: Date): { readonly weekday: number; readonly msOfDay: number; readonly localDayStartMs: number } {
  const local = at.getTime() + KARACHI_UTC_OFFSET_MS;
  const day = Math.floor(local / DAY_MS);
  return { weekday: (((day + EPOCH_WEEKDAY) % 7) + 7) % 7, msOfDay: local - day * DAY_MS, localDayStartMs: day * DAY_MS };
}

/** The rows that govern `productCode`: its own rows when it has any, otherwise the general rows. */
export function applicableRows(rows: readonly ServiceHoursRow[], productCode: string): readonly ServiceHoursRow[] {
  const own = rows.filter((r) => r.productCode === productCode);
  return own.length > 0 ? own : rows.filter((r) => r.productCode === null);
}

function windowOf(row: ServiceHoursRow): readonly [number, number] {
  return row.opensMs === row.closesMs ? [0, DAY_MS] : [row.opensMs, row.closesMs];
}

export function isOpen(rows: readonly ServiceHoursRow[], productCode: string, at: Date): boolean {
  const { weekday, msOfDay } = karachiLocal(at);
  return applicableRows(rows, productCode).some((r) => {
    const [start, end] = windowOf(r);
    return r.weekday === weekday && msOfDay >= start && msOfDay < end;
  });
}

/**
 * The next instant at or after `at` at which the product is open (`at` itself when open now), computed in
 * Asia/Karachi from server time (HRS-11); null when the product has no applicable rows at all.
 */
export function nextOpening(rows: readonly ServiceHoursRow[], productCode: string, at: Date): Date | null {
  const applicable = applicableRows(rows, productCode);
  if (applicable.length === 0) return null;
  const { weekday, localDayStartMs } = karachiLocal(at);
  const local = at.getTime() + KARACHI_UTC_OFFSET_MS;
  let best: number | null = null;
  for (let d = 0; d <= 7; d++) {
    for (const r of applicable) {
      if (r.weekday !== (weekday + d) % 7) continue;
      const [start, end] = windowOf(r);
      const s = localDayStartMs + d * DAY_MS + start;
      const e = localDayStartMs + d * DAY_MS + end;
      if (s <= local && local < e) return new Date(at.getTime());
      if (s > local && (best === null || s < best)) best = s;
    }
  }
  return best === null ? null : new Date(best - KARACHI_UTC_OFFSET_MS);
}

/** (product, weekday) groups whose windows overlap — refused when a zone set is submitted. */
export function overlappingWindows(rows: readonly ServiceHoursRow[]): ReadonlyArray<{ readonly productCode: string | null; readonly weekday: number }> {
  const groups = new Map<string, ServiceHoursRow[]>();
  for (const r of rows) {
    const k = `${r.productCode ?? ''}|${String(r.weekday)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Array<{ productCode: string | null; weekday: number }> = [];
  for (const group of groups.values()) {
    const sorted = group.map(windowOf).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev && cur && cur[0] < prev[1]) {
        const first = group[0];
        if (first) out.push({ productCode: first.productCode, weekday: first.weekday });
        break;
      }
    }
  }
  return out;
}
