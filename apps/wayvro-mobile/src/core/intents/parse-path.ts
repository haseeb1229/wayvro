import { IntentSchema, type Intent } from './intent';

/**
 * Bounded parser for system-delivered paths (V08; T3-17; ADR-043 decode-uri-component gate). The input length is
 * capped at 512 characters BEFORE anything else, and nothing is ever percent-decoded: the allowed character set has
 * no `%` or `+`, so a malformed encoding is rejected in linear time instead of reaching a decoder. Only allowlisted
 * paths with id-shaped parameters become intents; everything else lands on the mode home. In release builds no
 * external scheme is registered (F-P3-01, CI-gated), so this sees only app-internal launches; development builds
 * exercise it through the dev-client scheme.
 */
export const MAX_SYSTEM_PATH_LENGTH = 512;
const MAX_QUERY_PAIRS = 4;

export type ParsedPath =
  | { readonly kind: 'intent'; readonly intent: Intent }
  /** The root or an empty path: plain start, no intent. */
  | { readonly kind: 'none' }
  | { readonly kind: 'rejected'; readonly reason: 'TOO_LONG' | 'MALFORMED' | 'NOT_ALLOWED' };

/** scheme://authority prefix (bounded, linear); the authority of a custom scheme carries no route information here. */
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^/?#]{0,255}/;
/** Everything that may remain: no percent-encoding, no `+`, no whitespace, no non-ASCII. */
const SAFE_REST = /^[A-Za-z0-9/?=&._-]*$/;
const LEGAL_DOC = /^\/legal\/([A-Z_]{1,40})\/([1-9][0-9]{0,5})$/;

function queryParams(query: string): ReadonlyMap<string, string> | null {
  const params = new Map<string, string>();
  if (query === '') return params;
  const pairs = query.split('&');
  if (pairs.length > MAX_QUERY_PAIRS) return null;
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) return null;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === '' || value.includes('=') || params.has(key)) return null;
    params.set(key, value);
  }
  return params;
}

/** Path → candidate intent (ids are validated by IntentSchema afterwards). Unknown params make the path not allowed. */
function candidate(path: string, params: ReadonlyMap<string, string>): unknown {
  const only = (...keys: string[]): boolean => [...params.keys()].every((k) => keys.includes(k)) && keys.every((k) => params.has(k));
  const none = params.size === 0;
  switch (path) {
    case '/ride':
      return none ? { kind: 'OPEN_RIDER_HOME' } : null;
    case '/ride/quote':
      return only('group') ? { kind: 'OPEN_QUOTE', quoteGroupId: params.get('group') } : null;
    case '/drive':
      return none ? { kind: 'OPEN_DRIVER_HOME' } : null;
    case '/earn':
      return none ? { kind: 'OPEN_DRIVER_APPLICATION' } : null;
    case '/earn/compliance':
      return none ? { kind: 'OPEN_DRIVER_COMPLIANCE' } : null;
    case '/earn/renewal':
      return only('document') ? { kind: 'OPEN_DOCUMENT_RENEWAL', documentId: params.get('document') } : null;
    case '/account/appeal':
      return only('restriction') ? { kind: 'OPEN_RESTRICTION_APPEAL', restrictionId: params.get('restriction') } : null;
    case '/account':
      return none ? { kind: 'OPEN_ACCOUNT_SECURITY' } : null;
    case '/legal':
      return none ? { kind: 'OPEN_LEGAL' } : null;
    default: {
      const legal = none ? LEGAL_DOC.exec(path) : null;
      return legal === null ? null : { kind: 'OPEN_LEGAL', policyKey: legal[1], version: legal[2] };
    }
  }
}

export function parseWayvroPath(raw: string): ParsedPath {
  if (raw.length > MAX_SYSTEM_PATH_LENGTH) return { kind: 'rejected', reason: 'TOO_LONG' };
  let rest = raw;
  const prefix = SCHEME_PREFIX.exec(rest);
  if (prefix !== null) rest = rest.slice(prefix[0].length);
  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  if (!SAFE_REST.test(rest)) return { kind: 'rejected', reason: 'MALFORMED' };
  const q = rest.indexOf('?');
  let path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? '' : rest.slice(q + 1);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.includes('//') || path.includes('/.')) return { kind: 'rejected', reason: 'MALFORMED' };
  const params = queryParams(query);
  if (params === null) return { kind: 'rejected', reason: 'MALFORMED' };
  if ((path === '' || path === '/') && params.size === 0) return { kind: 'none' };
  const parsed = IntentSchema.safeParse(candidate(path, params));
  return parsed.success ? { kind: 'intent', intent: parsed.data } : { kind: 'rejected', reason: 'NOT_ALLOWED' };
}
