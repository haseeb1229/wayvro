/**
 * API endpoint resolution (P2.3). Pure: the values come from the app config `extra.wayvroApi` written at build time by
 * app.config.ts (WAYVRO_API_URL / WAYVRO_DEV_LOCAL_API / the E2E variant's port). There is no production URL guess
 * anywhere in the app: an unconfigured release build renders a "service not configured" state.
 */

/** Android-emulator loopback of the local API runner; reachable only from development builds that opt in. */
const DEV_LOCAL_API_URL = 'http://10.0.2.2:4000';
/** The same emulator loopback host for the SP-08 E2E variant (ADR-052); only the port comes from the build. */
const EMULATOR_LOOPBACK_ORIGIN = 'http://10.0.2.2';

export type ApiConfig =
  | { readonly kind: 'configured'; readonly baseUrl: string; readonly source: 'build-config' | 'dev-local' | 'e2e-loopback' }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'invalid' };

interface RawApiExtra {
  readonly baseUrl?: unknown;
  readonly devLocalApi?: unknown;
  readonly e2eLoopbackPort?: unknown;
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

const isUnprivilegedPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;

/**
 * @param extra  `Constants.expoConfig.extra`
 * @param isDevBuild  `__DEV__`; only development builds may use plain http or the local-runner fallback.
 *
 * `e2eLoopbackPort` exists only in the SP-08 E2E variant (`node scripts/android-build.mjs e2e`, ADR-052): the build
 * script writes it, `release` mode refuses to build while it is set, and the release-purity gate proves that the release
 * AAB carries neither it nor any cleartext permission. It can only ever name the emulator loopback host (the port is the
 * one variable), and the E2E variant's network security config permits cleartext to that host alone. Combined with a
 * `baseUrl` it is ambiguous and refused.
 */
export function resolveApiConfig(extra: unknown, isDevBuild: boolean): ApiConfig {
  const raw = readRaw(extra);
  const baseUrlValue = typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl : null;
  if (raw.e2eLoopbackPort !== undefined) {
    if (baseUrlValue !== null || !isUnprivilegedPort(raw.e2eLoopbackPort)) return { kind: 'invalid' };
    return { kind: 'configured', baseUrl: `${EMULATOR_LOOPBACK_ORIGIN}:${String(raw.e2eLoopbackPort)}`, source: 'e2e-loopback' };
  }
  if (baseUrlValue !== null) {
    const baseUrl = normaliseBaseUrl(baseUrlValue, isDevBuild);
    return baseUrl === null ? { kind: 'invalid' } : { kind: 'configured', baseUrl, source: 'build-config' };
  }
  if (isDevBuild && raw.devLocalApi === true) return { kind: 'configured', baseUrl: DEV_LOCAL_API_URL, source: 'dev-local' };
  return { kind: 'unconfigured' };
}
