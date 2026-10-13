/**
 * SYNTHETIC search aliases for the synthetic Lahore gazetteer — DEVELOPMENT/TEST ONLY (A06; ADR-045; docs/phase3/
 * PHASE3_MOBILE_UX_AND_NAVIGATION.md §14). Data only (no imports), so dev tools can read it directly.
 *
 * Every alias is a common spelling variant (Roman Urdu as typed on phones, English misspellings, Urdu script) of a
 * public-landmark name that already exists in `SYNTHETIC_GAZETTEER` (packages/provider-test-doubles/src/geo.ts): no
 * address, no private place, nothing captured from a provider. `alias` and `canonical` are stored already in the
 * search normaliser's canonical form (lower case, single spaces; asserted by the API's normaliser tests), so lookup
 * stays an exact match. The Urdu-script and Roman-Urdu spellings are AI-drafted and PENDING native review (FA-09).
 *
 * The seed writes them as PROPOSED only: an alias is used by search only after the staff maker-checker flow approves
 * it (approver ≠ creator, enforced by the database). `alias` alone finds nothing in the synthetic gazetteer — that is
 * what the alias is for.
 */
export interface SyntheticLandmarkAlias {
  /** Fixed synthetic id (idempotent seed). */
  readonly id: string;
  readonly locale: 'en' | 'ur' | 'ur-Latn';
  readonly alias: string;
  /** The search text the alias expands to (a gazetteer name). */
  readonly canonical: string;
  /** Gazetteer place id the canonical query finds. */
  readonly placeId: string;
}

const id = (n: number): string => `00000000-0000-7000-8000-0000000a${n.toString(16).padStart(4, '0')}`;

const rows: readonly (readonly [SyntheticLandmarkAlias['locale'], string, string, string])[] = [
  ['ur-Latn', 'libarti market', 'liberty market', 'syn-lhr-001'],
  ['ur-Latn', 'liberti market', 'liberty market', 'syn-lhr-001'],
  ['en', 'liberty mkt', 'liberty market', 'syn-lhr-001'],
  ['ur', 'لبرٹی مارکیٹ', 'liberty market', 'syn-lhr-001'],
  ['ur-Latn', 'badshai masjid', 'badshahi mosque', 'syn-lhr-002'],
  ['ur-Latn', 'baadshahi masjid', 'badshahi mosque', 'syn-lhr-002'],
  ['en', 'badshahi mosk', 'badshahi mosque', 'syn-lhr-002'],
  ['ur-Latn', 'meenar e pakistan', 'minar-e-pakistan', 'syn-lhr-003'],
  ['ur-Latn', 'minar pakistan', 'minar-e-pakistan', 'syn-lhr-003'],
  ['en', 'minar-i-pakistan', 'minar-e-pakistan', 'syn-lhr-003'],
  ['ur', 'مینارِ پاکستان', 'minar-e-pakistan', 'syn-lhr-003'],
  ['ur-Latn', 'daata darbar', 'data darbar', 'syn-lhr-004'],
  ['ur-Latn', 'data darbaar', 'data darbar', 'syn-lhr-004'],
  ['ur', 'داتا دربار', 'data darbar', 'syn-lhr-004'],
  ['ur-Latn', 'anar kali', 'anarkali bazaar', 'syn-lhr-005'],
  ['en', 'anarkalli bazaar', 'anarkali bazaar', 'syn-lhr-005'],
  ['ur', 'انارکلی بازار', 'anarkali bazaar', 'syn-lhr-005'],
  ['ur-Latn', 'allama iqbal airport', 'allama iqbal international airport', 'syn-lhr-006'],
  ['en', 'lhr airport', 'allama iqbal international airport', 'syn-lhr-006'],
  ['ur', 'لاہور ایئرپورٹ', 'allama iqbal international airport', 'syn-lhr-006'],
  ['ur-Latn', 'railway stashun', 'lahore railway station', 'syn-lhr-007'],
  ['en', 'rail station', 'lahore railway station', 'syn-lhr-007'],
  ['ur', 'ریلوے اسٹیشن', 'lahore railway station', 'syn-lhr-007'],
  ['ur-Latn', 'emporium maal', 'emporium mall', 'syn-lhr-008'],
  ['en', 'emporeum mall', 'emporium mall', 'syn-lhr-008'],
  ['ur-Latn', 'pakages mall', 'packages mall', 'syn-lhr-009'],
  ['en', 'package mall', 'packages mall', 'syn-lhr-009'],
  ['ur-Latn', 'model taun', 'model town', 'syn-lhr-010'],
  ['ur-Latn', 'modal town', 'model town', 'syn-lhr-010'],
  ['en', 'dha phase three', 'dha phase 3', 'syn-lhr-011'],
  ['ur-Latn', 'difence phase 3', 'dha phase 3', 'syn-lhr-011'],
  ['ur-Latn', 'qaddafi stadium', 'gaddafi stadium', 'syn-lhr-012'],
  ['en', 'gadafi stadium', 'gaddafi stadium', 'syn-lhr-012'],
  ['ur', 'قذافی اسٹیڈیم', 'gaddafi stadium', 'syn-lhr-012'],
  ['ur-Latn', 'kalma chok', 'kalma chowk', 'syn-lhr-013'],
  ['ur-Latn', 'kalmah chowk', 'kalma chowk', 'syn-lhr-013'],
  ['ur', 'کلمہ چوک', 'kalma chowk', 'syn-lhr-013'],
  ['ur-Latn', 'maal road', 'mall road gpo chowk', 'syn-lhr-014'],
  ['en', 'g p o chowk', 'mall road gpo chowk', 'syn-lhr-014'],
];

export const SYNTHETIC_LANDMARK_ALIASES: readonly SyntheticLandmarkAlias[] = rows.map(([locale, alias, canonical, placeId], i) => ({
  id: id(i + 1),
  locale,
  alias,
  canonical,
  placeId,
}));

/**
 * The inert staff row that "proposes" the synthetic aliases (the table needs a creator). OFFBOARDED from the start: it
 * has no credential, can never sign in and can never approve anything; a real, different staff member must approve.
 */
export const SYNTHETIC_ALIAS_PROPOSER = {
  staffId: '00000000-0000-7000-8000-0000000a0000',
  displayName: 'SYNTHETIC alias seed (local/test only, cannot sign in)',
  workEmail: 'synthetic-alias-seed@example.invalid',
} as const;
