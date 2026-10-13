/**
 * Lahore address formatter (Phase 3 P3.2; docs/phase3/PHASE3_ARCHITECTURE.md §5.5; UNIT-FMT). Pure: from normalised
 * provider components produce a landmark-first two-line label.
 *   primary   = landmark/place name, else "Block X, Society", else society, else area, else city
 *   secondary = the remaining area and city (deduplicated), or null
 *   landmark  = the place name when the provider supplied one
 * Urdu-script text appears only when the PROVIDER supplied it (`nameUrdu`, shown for the `ur` locale) — never
 * machine-transliterated. Nothing is invented: with no usable component the result is null and the client shows its
 * own "Pinned location" label; raw coordinates are never turned into text. Every string is stripped of control
 * characters, whitespace-collapsed and capped (provider text is untrusted, threat model T3-21).
 */
import type { AddressComponents, GeoLocale } from '@wayvro/provider-interfaces';
import { stripInvisible } from './normalise.js';

const DISPLAY_TEXT_MAX = 200;

export interface FormattedAddress {
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly landmarkText: string | null;
}

/** Untrusted provider text → safe display text (or null when nothing visible remains). */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = Array.from(stripInvisible(value.normalize('NFC')).replace(/\s+/gu, ' ').trim())
    .slice(0, DISPLAY_TEXT_MAX)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

const same = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');

export function formatAddress(components: AddressComponents, locale: GeoLocale): FormattedAddress | null {
  const name = cleanText(components.name);
  const nameUrdu = cleanText(components.nameUrdu);
  const block = cleanText(components.block);
  const society = cleanText(components.society);
  const area = cleanText(components.area);
  const city = cleanText(components.city);

  const landmark = locale === 'ur' && nameUrdu !== null ? nameUrdu : name;
  let primary: string | null;
  const used: Array<string | null> = [];
  if (landmark !== null) {
    primary = landmark;
  } else if (block !== null && society !== null) {
    primary = `${block}, ${society}`;
    used.push(block, society);
  } else if (society !== null) {
    primary = society;
    used.push(society);
  } else if (block !== null && area !== null) {
    primary = `${block}, ${area}`;
    used.push(block, area);
  } else if (area !== null) {
    primary = area;
    used.push(area);
  } else {
    primary = null;
  }

  const tail: string[] = [];
  for (const part of landmark !== null ? [society, area, city] : [area, city]) {
    if (part === null || used.some((u) => same(u, part)) || tail.some((t) => same(t, part))) continue;
    tail.push(part);
  }
  if (primary === null) {
    // only a city (or nothing): a city alone is a real, if coarse, label; nothing at all means "no address"
    if (city === null) return null;
    return { primaryText: city, secondaryText: null, landmarkText: null };
  }
  const secondary = tail.length > 0 ? cleanText(tail.join(', ')) : null;
  return { primaryText: primary, secondaryText: secondary, landmarkText: landmark };
}
