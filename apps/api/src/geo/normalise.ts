/**
 * Search-text canonicalisation (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.2 step 1; threat model T3-10/T3-11;
 * PROP-NORM). Pure and idempotent:
 *   Unicode NFKC → invisible/bidi control characters become spaces (ZWNJ/ZWJ are kept: they carry meaning in Urdu
 *   script) → whitespace collapsed and trimmed → Latin case-folded (Urdu script has no case and is left as typed) →
 *   leading/trailing punctuation trimmed (unless that would empty the query) → bounded to 80 code points.
 * The same function normalises landmark aliases when staff enter them, so alias lookup is an exact match.
 */

/** @internal exported for unit tests */
export const QUERY_MAX_CODE_POINTS = 80;
export const QUERY_MIN_CODE_POINTS = 3;

/**
 * C0/C1 controls, zero-width space, LRM/RLM, line/paragraph separators, bidi embeddings/isolates, word joiners, BOM.
 * U+200C (ZWNJ) and U+200D (ZWJ) are deliberately absent.
 */
function invisible(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x200b ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff
  );
}

/** Replaces invisible/control characters with spaces (also used to sanitise provider display text). */
export function stripInvisible(s: string): string {
  return Array.from(s, (ch) => (invisible(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('');
}

const EDGE_PUNCTUATION = /^[\p{P}\s]+|[\p{P}\s]+$/gu;

function step(input: string): string {
  const collapsed = stripInvisible(input.normalize('NFKC')).replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
  const bounded = Array.from(collapsed).slice(0, QUERY_MAX_CODE_POINTS).join('').trim();
  const stripped = bounded.replace(EDGE_PUNCTUATION, '');
  return stripped.length > 0 ? stripped : bounded;
}

/** Canonical form of a search query or alias (idempotent; never empties a query that has visible characters). */
export function normaliseQuery(input: string): string {
  let current = step(input);
  for (let i = 0; i < 4; i++) {
    const next = step(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Length in code points (what the 3..80 rule counts; Urdu letters count one each). */
export function codePointLength(s: string): number {
  return Array.from(s).length;
}
