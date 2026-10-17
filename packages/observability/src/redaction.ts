/**
 * PII / secret redaction foundation (Q36 default-deny list, CLAUDE.md §11). Applied to every structured log record
 * before it leaves the process. Two layers:
 *   1. key-based: values under sensitive keys are replaced entirely, at any depth;
 *   2. value-based: free text is scrubbed for Pakistani CNICs, phone numbers, bearer/JWT tokens, card-like numbers,
 *      e-mail addresses, URL credentials and precise coordinates.
 * Redaction is lossy on purpose; observability must never become a second PII store. P2.1 adds OTP/nonce/challenge/
 * installation/idempotency/envelope keys, Wayvro session tokens and presigned-URL credentials (Q36). Phase 3 (P3.2) adds
 * polyline/placeRef/search-text/pickup/dropoff/bbox/route-geometry keys and sealed `pr1.` placeRef tokens (T3-28).
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = new RegExp(
  [
    'pass(word)?',
    'secret',
    'token',
    'authorization',
    'cookie',
    'session',
    'api[-_]?key',
    'private[-_]?key',
    'otp',
    'otp_?code',
    'verification_?code',
    'nonce',
    'challenge_?id',
    'installation_?id',
    'idempotency_?key',
    'envelope',
    'sealed',
    'mac',
    'x_amz_(signature|credential|security_token)',
    'pin',
    'cnic',
    'nic(op)?',
    'passport',
    'licen[cs]e[-_]?(no|number)',
    'selfie',
    'biometric',
    'face',
    'phone',
    'msisdn',
    'mobile',
    'email',
    'card',
    'pan',
    'cvv',
    'iban',
    'account[-_]?(no|number)',
    'lat(itude)?',
    'lng|lon(gitude)?',
    'coordinates?',
    'geo(m|metry|location)?',
    'address',
    'attachment',
    // Phase 3 P3.2 geo (docs/phase3/PHASE3_ARCHITECTURE.md §10; threat model T3-28): routes, sealed place references,
    // search text, trip endpoints and bounding boxes
    'polyline',
    'place_?ref',
    'search_?(text|query)',
    'pickup',
    'dropoff',
    'bbox',
    'route_?geometry',
  ]
    .map((k) => `^(?:.*[-_.])?(?:${k})(?:[-_.].*)?$`)
    .join('|'),
  'i',
);

const VALUE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Wayvro opaque session tokens (access wva_ / refresh wvr_)
  [/\bwv[ar]_[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]'],
  // sealed placeRef tokens (Phase 3 P3.2): opaque, but account-bound and replayable until expiry
  [/\bpr1\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_PLACE_REF]'],
  // presigned-URL credentials
  [/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[REDACTED_JWT]'],
  [/\b\d{5}-\d{7}-\d\b/g, '[REDACTED_CNIC]'],
  [/(?<!\d)\d{13}(?!\d)/g, '[REDACTED_CNIC]'],
  [/(?:\+|00)?92[\s-]?3\d{2}[\s-]?\d{7}\b|\b03\d{2}[\s-]?\d{7}\b/g, '[REDACTED_PHONE]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_CARD]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[REDACTED_COORDINATES]'],
];

export function isSensitiveKey(key: string): boolean {
  // camelCase -> snake_case so `accessToken`, `phoneNumber`, `cnicFront` match the token patterns.
  return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Deep-copies `value`, redacting sensitive keys and scrubbing strings. Cycles and excessive depth are cut. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1, seen);
  return out;
}
