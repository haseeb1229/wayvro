/**
 * COMPAT-N1 helpers (test-only, docs/phase3/PHASE3_TEST_STRATEGY.md §4.10): a deterministic sample generator and a
 * structural "every value the producer can send is accepted by the consumer" checker over the JSON Schema subset that
 * zod 4's `z.toJSONSchema` emits for the Wayvro contracts. Both REFUSE a keyword, format or pattern they do not know, so
 * a future schema construct fails loudly here instead of being skipped silently.
 *
 * Paths are data paths: `$` is the body, `.name` a property, `[]` an array item, `{}` a record value.
 */
import { z } from 'zod';

export type JsonSchema = Readonly<Record<string, unknown>>;

export const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output'): JsonSchema =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw', io });

/** Keywords that only annotate (no effect on which values are valid). */
const ANNOTATIONS = new Set(['$schema', '$defs', 'description', 'title', 'default', 'examples', 'deprecated']);
const ASSERTIONS = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'minItems',
  'maxItems',
  'anyOf',
]);

const isSchema = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (s: JsonSchema, k: string): number | undefined => (typeof s[k] === 'number' ? s[k] : undefined);
const str = (s: JsonSchema, k: string): string | undefined => (typeof s[k] === 'string' ? s[k] : undefined);
const props = (s: JsonSchema): Readonly<Record<string, JsonSchema>> => {
  const p = s['properties'];
  return isSchema(p) ? (p as Readonly<Record<string, JsonSchema>>) : {};
};
const requiredKeys = (s: JsonSchema): ReadonlySet<string> => new Set(Array.isArray(s['required']) ? (s['required'] as string[]) : []);
const enumValues = (s: JsonSchema): readonly unknown[] | undefined =>
  'const' in s ? [s['const']] : Array.isArray(s['enum']) ? (s['enum'] as readonly unknown[]) : undefined;

function assertKnownKeywords(s: JsonSchema, path: string): void {
  for (const k of Object.keys(s)) {
    if (!ANNOTATIONS.has(k) && !ASSERTIONS.has(k))
      throw new Error(`COMPAT-N1: unsupported JSON Schema keyword "${k}" at ${path} — extend json-schema-compat.ts`);
  }
}

const without = (s: JsonSchema, key: string): JsonSchema => Object.fromEntries(Object.entries(s).filter(([k]) => k !== key));

/** Follows `$ref` (only `#` and `#/$defs/<id>` occur) and merges sibling keywords. */
function resolve(s: JsonSchema, root: JsonSchema, path: string): JsonSchema {
  let current = s;
  for (let hops = 0; ; hops += 1) {
    const ref = current['$ref'];
    if (typeof ref !== 'string') break;
    if (hops > 32) throw new Error(`COMPAT-N1: $ref loop at ${path}`);
    const defs = isSchema(root['$defs']) ? root['$defs'] : {};
    const target = ref === '#' ? root : ref.startsWith('#/$defs/') ? defs[ref.slice('#/$defs/'.length)] : undefined;
    if (!isSchema(target)) throw new Error(`COMPAT-N1: unresolvable $ref "${ref}" at ${path}`);
    current = { ...target, ...without(current, '$ref') };
  }
  assertKnownKeywords(current, path);
  return current;
}

/** The alternatives of a node: `anyOf` options, or one copy per entry of a `type` array; otherwise the node itself. */
function branches(s: JsonSchema): readonly JsonSchema[] {
  const anyOf = s['anyOf'];
  if (Array.isArray(anyOf)) {
    const rest = without(s, 'anyOf');
    return (anyOf as JsonSchema[]).map((o) => ({ ...rest, ...o }));
  }
  const type = s['type'];
  if (Array.isArray(type)) return (type as string[]).map((t) => ({ ...s, type: t }));
  return [s];
}

const hasAssertions = (s: JsonSchema): boolean => Object.keys(s).some((k) => ASSERTIONS.has(k));

const compileRegex = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return new RegExp(pattern);
  }
};

// ── sample generation ─────────────────────────────────────────────────────────────────────────────────────────────
const FORMAT_SAMPLES: Readonly<Record<string, string>> = {
  'date-time': '2026-10-14T09:30:00.000Z',
  date: '2026-10-14',
  uuid: '0190f0a0-0000-7000-8000-00000000c0a1',
  uri: 'https://example.test/compat',
  email: 'compat.reviewer@example.test',
};
/** Synthetic values tried in order against a pattern (never real identifiers, tokens or numbers). */
const STRING_CANDIDATES: readonly string[] = [
  'SYNTHETIC_CODE',
  'KHI',
  'ECONOMY',
  'LEA-1234',
  'synthetic-value-0001',
  'seats',
  '03001234567',
  '+923001234567',
  '048213',
  '1.0.0',
  '1',
  'aaa.bbb.ccc',
  '00000-0000000-0',
  'a'.repeat(64),
  '/legal/terms/v1',
  `wvs_${'A'.repeat(43)}`,
  `wvi_${'A'.repeat(43)}`,
  'synthetic text',
];

export interface SampleOptions {
  /** Picks option `variant % n` at every choice point (enum value, anyOf branch, optional key, boolean). */
  readonly variant: number;
  /** Narrows the enum values offered at a path (e.g. to the Phase-2 vocabulary, or to only the values Phase 3 added). */
  readonly enumFilter?: (path: string, values: readonly unknown[]) => readonly unknown[];
  /** Query strings carry text: render scalars as strings. */
  readonly scalarsAsStrings?: boolean;
}

function sampleString(s: JsonSchema, path: string): string {
  const format = str(s, 'format');
  const pattern = str(s, 'pattern');
  const minLength = num(s, 'minLength') ?? 0;
  const maxLength = num(s, 'maxLength') ?? Number.POSITIVE_INFINITY;
  const fits = (v: string): boolean => v.length >= minLength && v.length <= maxLength && (pattern === undefined || compileRegex(pattern).test(v));
  if (format !== undefined) {
    const v = FORMAT_SAMPLES[format];
    if (v === undefined || !fits(v)) throw new Error(`COMPAT-N1: no synthetic sample for format "${format}" at ${path}`);
    return v;
  }
  if (pattern === undefined) {
    const padded = 'synthetic text'.padEnd(minLength, 'x');
    return padded.slice(0, Math.min(padded.length, maxLength));
  }
  const v = STRING_CANDIDATES.find(fits);
  if (v === undefined) throw new Error(`COMPAT-N1: no synthetic sample matches pattern /${pattern}/ at ${path} — add one to STRING_CANDIDATES`);
  return v;
}

function sampleNumber(s: JsonSchema): number {
  const min = num(s, 'minimum');
  const exMin = num(s, 'exclusiveMinimum');
  const max = num(s, 'maximum');
  const exMax = num(s, 'exclusiveMaximum');
  let v = Math.max(1, min ?? Number.NEGATIVE_INFINITY, exMin === undefined ? Number.NEGATIVE_INFINITY : exMin + 1);
  if (max !== undefined && v > max) v = max;
  if (exMax !== undefined && v >= exMax) v = exMax - 1;
  return v;
}

/** One deterministic sample; `choices` reports the largest choice-point cardinality met (variants needed to see all). */
function generateSample(root: JsonSchema, options: SampleOptions): { readonly value: unknown; readonly choices: number } {
  let choices = 1;
  const pick = <T>(values: readonly T[], path: string): T => {
    if (values.length === 0) throw new Error(`COMPAT-N1: empty choice at ${path}`);
    choices = Math.max(choices, values.length);
    return values[options.variant % values.length] as T;
  };
  const scalar = (v: string | number | boolean): unknown => (options.scalarsAsStrings === true ? String(v) : v);
  const gen = (node: JsonSchema, path: string, depth: number): unknown => {
    if (depth > 24) throw new Error(`COMPAT-N1: schema too deep (recursive?) at ${path}`);
    const s = resolve(node, root, path);
    const alternatives = branches(s);
    if (alternatives.length > 1) return gen(pick(alternatives, `${path}|`), path, depth + 1);
    const fixed = enumValues(s);
    if (fixed !== undefined) {
      const offered = options.enumFilter ? options.enumFilter(path, fixed) : fixed;
      const v = pick(offered, path);
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? scalar(v) : v;
    }
    switch (s['type']) {
      case 'string':
        return sampleString(s, path);
      case 'integer':
      case 'number':
        return scalar(sampleNumber(s));
      case 'boolean':
        return scalar(pick([true, false], path));
      case 'null':
        return null;
      case 'array': {
        const items = s['items'];
        if (!isSchema(items)) throw new Error(`COMPAT-N1: array without items at ${path}`);
        const count = Math.max(1, num(s, 'minItems') ?? 0);
        return Array.from({ length: count }, () => gen(items, `${path}[]`, depth + 1));
      }
      case 'object': {
        const out: Record<string, unknown> = {};
        const required = requiredKeys(s);
        for (const [k, child] of Object.entries(props(s))) {
          if (required.has(k) || pick([true, false], `${path}.${k}?`)) out[k] = gen(child, `${path}.${k}`, depth + 1);
        }
        const extra = s['additionalProperties'];
        if (Object.keys(props(s)).length === 0 && isSchema(extra)) {
          const names = s['propertyNames'];
          const key = isSchema(names) ? gen(names, `${path}{key}`, depth + 1) : 'compat_key';
          out[String(key)] = gen(extra, `${path}{}`, depth + 1);
        }
        return out;
      }
      default:
        if (!hasAssertions(s)) return 'synthetic text';
        throw new Error(`COMPAT-N1: cannot sample ${JSON.stringify(s)} at ${path}`);
    }
  };
  const value = gen(root, '$', 0);
  return { value, choices };
}

/** Every variant needed for each choice point to show each of its options at least once (deduplicated). */
export function generateSamples(root: JsonSchema, options: Omit<SampleOptions, 'variant'> = {}): readonly unknown[] {
  const seen = new Map<string, unknown>();
  let needed = 1;
  for (let variant = 0; variant < needed; variant += 1) {
    const { value, choices } = generateSample(root, { ...options, variant });
    needed = Math.max(needed, choices);
    seen.set(JSON.stringify(value), value);
  }
  return [...seen.values()];
}

// ── structural acceptance ─────────────────────────────────────────────────────────────────────────────────────────
interface EnumComparison {
  readonly path: string;
  /** Values the producer may send at this path. */
  readonly producer: readonly unknown[];
  /** Values the consumer accepts there. */
  readonly consumer: readonly unknown[];
  /** Producer values the consumer rejects (a closed-enum widening when non-empty). */
  readonly added: readonly unknown[];
}
export interface CompatReport {
  readonly violations: readonly string[];
  readonly enums: readonly EnumComparison[];
  /** Producer properties the consumer does not declare (accepted and stripped by a non-strict consumer). */
  readonly additiveFields: readonly string[];
}
export interface CompatOptions {
  /** Paths whose closed enum may legitimately grow (an allow-listed, justified extensible vocabulary). */
  readonly extensibleEnumPaths?: ReadonlySet<string>;
}

interface Report {
  violations: string[];
  enums: EnumComparison[];
  additiveFields: string[];
}
const emptyReport = (): Report => ({ violations: [], enums: [], additiveFields: [] });
const merge = (into: Report, from: Report): void => {
  into.violations.push(...from.violations);
  into.enums.push(...from.enums);
  into.additiveFields.push(...from.additiveFields);
};

/**
 * Proves structurally that every value valid under `producer` is accepted by `consumer` (producer ⊆ consumer): for a
 * response, producer = Phase-3 schema (io output) and consumer = Phase-2 schema (io input, i.e. what the old client's
 * parser accepts); for a request, producer = Phase-2 (input) and consumer = Phase-3 (input). Anything it cannot prove
 * (a changed pattern or format, a narrowed bound) is a violation, never a pass.
 */
export function checkAccepts(producerRoot: JsonSchema, consumerRoot: JsonSchema, options: CompatOptions = {}): CompatReport {
  const extensible = options.extensibleEnumPaths ?? new Set<string>();
  const accepts = (pNode: JsonSchema, cNode: JsonSchema, path: string, depth: number): Report => {
    const r = emptyReport();
    if (depth > 24) {
      r.violations.push(`${path}: schema too deep (recursive?)`);
      return r;
    }
    const p = resolve(pNode, producerRoot, path);
    const c = resolve(cNode, consumerRoot, path);
    if (!hasAssertions(c)) return r; // the consumer accepts anything here
    const pAlternatives = branches(p);
    if (pAlternatives.length > 1) {
      for (const alt of pAlternatives) merge(r, accepts(alt, c, path, depth + 1));
      return r;
    }
    const cAlternatives = branches(c);
    if (cAlternatives.length > 1) {
      const sameType = cAlternatives.filter((alt) => alt['type'] === p['type'] || (p['type'] === 'integer' && alt['type'] === 'number'));
      const candidates = sameType.length > 0 ? sameType : cAlternatives;
      const reports = candidates.map((alt) => accepts(p, alt, path, depth + 1));
      merge(r, reports.find((x) => x.violations.length === 0) ?? (reports[0] as Report));
      return r;
    }
    const pValues = enumValues(p);
    const cValues = enumValues(c);
    if (pValues !== undefined) {
      if (cValues !== undefined) {
        const added = pValues.filter((v) => !cValues.includes(v));
        r.enums.push({ path, producer: pValues, consumer: cValues, added });
        if (added.length > 0 && !extensible.has(path)) r.violations.push(`${path}: closed enum widened by ${JSON.stringify(added)}`);
        return r;
      }
      for (const v of pValues) {
        if (!scalarAccepted(v, c)) r.violations.push(`${path}: consumer rejects producer value ${JSON.stringify(v)}`);
      }
      return r;
    }
    if (cValues !== undefined) {
      r.violations.push(`${path}: consumer accepts only ${JSON.stringify(cValues)} but the producer sends an open ${String(p['type'])}`);
      return r;
    }
    const pType = p['type'];
    const cType = c['type'];
    if (pType !== cType && !(pType === 'integer' && cType === 'number')) {
      r.violations.push(`${path}: type ${String(pType)} is not accepted as ${String(cType)}`);
      return r;
    }
    switch (pType) {
      case 'string': {
        for (const k of ['pattern', 'format'] as const) {
          if (c[k] !== undefined && p[k] !== c[k]) r.violations.push(`${path}: ${k} ${JSON.stringify(p[k])} is not provably within ${JSON.stringify(c[k])}`);
        }
        boundAtLeast(r, path, 'minLength', num(p, 'minLength'), num(c, 'minLength'));
        boundAtMost(r, path, 'maxLength', num(p, 'maxLength'), num(c, 'maxLength'));
        return r;
      }
      case 'integer':
      case 'number': {
        boundAtLeast(r, path, 'minimum', lower(p), lower(c));
        boundAtMost(r, path, 'maximum', upper(p), upper(c));
        return r;
      }
      case 'array': {
        const pItems = p['items'];
        const cItems = c['items'];
        if (isSchema(pItems) && isSchema(cItems)) merge(r, accepts(pItems, cItems, `${path}[]`, depth + 1));
        else r.violations.push(`${path}: array items not comparable`);
        boundAtLeast(r, path, 'minItems', num(p, 'minItems'), num(c, 'minItems'));
        boundAtMost(r, path, 'maxItems', num(p, 'maxItems'), num(c, 'maxItems'));
        return r;
      }
      case 'object': {
        const pProps = props(p);
        const cProps = props(c);
        const pRequired = requiredKeys(p);
        for (const k of requiredKeys(c)) {
          if (!pRequired.has(k)) r.violations.push(`${path}.${k}: required by the consumer but ${k in pProps ? 'optional' : 'absent'} in the producer`);
        }
        const cExtra = c['additionalProperties'];
        for (const [k, child] of Object.entries(pProps)) {
          const cChild = cProps[k];
          if (cChild !== undefined) merge(r, accepts(child, cChild, `${path}.${k}`, depth + 1));
          else if (cExtra === false) r.violations.push(`${path}.${k}: the consumer object is strict and rejects this field`);
          else if (isSchema(cExtra)) merge(r, accepts(child, cExtra, `${path}.${k}`, depth + 1));
          else r.additiveFields.push(`${path}.${k}`);
        }
        const pExtra = p['additionalProperties'];
        if (isSchema(pExtra)) {
          // a record (or catch-all): its values and key names must be accepted too
          if (cExtra === false) r.violations.push(`${path}{}: the consumer object is strict and rejects record keys`);
          else if (isSchema(cExtra)) merge(r, accepts(pExtra, cExtra, `${path}{}`, depth + 1));
          const pNames = p['propertyNames'];
          const cNames = c['propertyNames'];
          if (isSchema(cNames)) merge(r, accepts(isSchema(pNames) ? pNames : { type: 'string' }, cNames, `${path}{key}`, depth + 1));
        }
        return r;
      }
      case 'boolean':
      case 'null':
        return r;
      default:
        r.violations.push(`${path}: cannot compare ${JSON.stringify(p)}`);
        return r;
    }
  };
  const result = accepts(producerRoot, consumerRoot, '$', 0);
  return result;
}

const lower = (s: JsonSchema): number | undefined => {
  const min = num(s, 'minimum');
  const ex = num(s, 'exclusiveMinimum');
  if (min === undefined && ex === undefined) return undefined;
  // an integer above an exclusive bound is at least bound + 1; for numbers the exclusive bound itself is a safe lower bound
  const exAsInclusive = ex === undefined ? Number.NEGATIVE_INFINITY : s['type'] === 'integer' ? ex + 1 : ex;
  return Math.max(min ?? Number.NEGATIVE_INFINITY, exAsInclusive);
};
const upper = (s: JsonSchema): number | undefined => {
  const max = num(s, 'maximum');
  const ex = num(s, 'exclusiveMaximum');
  if (max === undefined && ex === undefined) return undefined;
  const exAsInclusive = ex === undefined ? Number.POSITIVE_INFINITY : s['type'] === 'integer' ? ex - 1 : ex;
  return Math.min(max ?? Number.POSITIVE_INFINITY, exAsInclusive);
};
function boundAtLeast(r: Report, path: string, name: string, producer: number | undefined, consumer: number | undefined): void {
  if (consumer !== undefined && (producer === undefined || producer < consumer))
    r.violations.push(`${path}: ${name} ${String(producer)} is below the consumer's ${String(consumer)}`);
}
function boundAtMost(r: Report, path: string, name: string, producer: number | undefined, consumer: number | undefined): void {
  if (consumer !== undefined && (producer === undefined || producer > consumer))
    r.violations.push(`${path}: ${name} ${String(producer)} exceeds the consumer's ${String(consumer)}`);
}

function scalarAccepted(v: unknown, c: JsonSchema): boolean {
  switch (c['type']) {
    case 'string': {
      if (typeof v !== 'string') return false;
      const pattern = str(c, 'pattern');
      if (c['format'] !== undefined && pattern === undefined) return false; // a format without a pattern is not provable here
      return (
        v.length >= (num(c, 'minLength') ?? 0) &&
        v.length <= (num(c, 'maxLength') ?? Number.POSITIVE_INFINITY) &&
        (pattern === undefined || compileRegex(pattern).test(v))
      );
    }
    case 'integer':
      return Number.isInteger(v) && withinBounds(v as number, c);
    case 'number':
      return typeof v === 'number' && withinBounds(v, c);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      return false;
  }
}
const withinBounds = (v: number, c: JsonSchema): boolean => v >= (lower(c) ?? Number.NEGATIVE_INFINITY) && v <= (upper(c) ?? Number.POSITIVE_INFINITY);

/** Paths of objects that reject unknown keys (`additionalProperties: false` in an io `input` schema = z.strictObject). */
export function strictObjectPaths(root: JsonSchema): ReadonlySet<string> {
  const out = new Set<string>();
  const walk = (node: JsonSchema, path: string, depth: number): void => {
    if (depth > 24) return;
    const s = resolve(node, root, path);
    for (const alt of branches(s)) {
      if (alt['type'] === 'object') {
        if (alt['additionalProperties'] === false) out.add(path);
        for (const [k, child] of Object.entries(props(alt))) walk(child, `${path}.${k}`, depth + 1);
        const extra = alt['additionalProperties'];
        if (isSchema(extra)) walk(extra, `${path}{}`, depth + 1);
      } else if (alt['type'] === 'array' && isSchema(alt['items'])) walk(alt['items'], `${path}[]`, depth + 1);
    }
  };
  walk(root, '$', 0);
  return out;
}
