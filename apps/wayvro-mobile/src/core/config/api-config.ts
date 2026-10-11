/**
 * API endpoint resolution (P2.3). Pure: the values come from the app config `extra.wayvroApi` written at build time by
 * app.config.ts (WAYVRO_API_URL / WAYVRO_DEV_LOCAL_API). There is no production URL guess anywhere in the app: an
 * unconfigured release build renders a "service not configured" state.
 */

/** Android-emulator loopback of the local API runner; reachable only from development builds that opt in. */
const DEV_LOCAL_API_URL = 'http://10.0.2.2:4000';

export type ApiConfig =
  | { readonly kind: 'configured'; readonly baseUrl: string; readonly source: 'build-config' | 'dev-local' }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'invalid' };

interface RawApiExtra {
  readonly baseUrl?: unknown;
  readonly devLocalApi?: unknown;
}

function readRaw(extra: unknown): RawApiExtra {
  if (extra === null || typeof extra !== 'object') return {};
  const api = (extra as { wayvroApi?: unknown }).wayvroApi;
  return api !== null && typeof api === 'object' ? api : {};
}

/** Strict origin check: absolute http(s) URL without credentials, query or fragment; trailing slashes removed. */
function normaliseBaseUrl(value: string, allowInsecure: boolean): string | null {
  const match = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.exec(value.trim());
  if (!match) return null;
  if (match[1] === 'http' && !allowInsecure) return null;
  return value.trim().replace(/\/+$/, '');
}

/**
 * @param extra  `Constants.expoConfig.extra`
 * @param isDevBuild  `__DEV__`; only development builds may use plain http or the local-runner fallback.
 */
export function resolveApiConfig(extra: unknown, isDevBuild: boolean): ApiConfig {
  const raw = readRaw(extra);
  if (typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '') {
    const baseUrl = normaliseBaseUrl(raw.baseUrl, isDevBuild);
    return baseUrl === null ? { kind: 'invalid' } : { kind: 'configured', baseUrl, source: 'build-config' };
  }
  if (isDevBuild && raw.devLocalApi === true) return { kind: 'configured', baseUrl: DEV_LOCAL_API_URL, source: 'dev-local' };
  return { kind: 'unconfigured' };
}
