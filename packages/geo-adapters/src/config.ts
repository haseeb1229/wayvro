/**
 * Validated configuration loaders, one per candidate bundle. Credentials are read ONLY from the environment at run time
 * (founder decision: no key exists in Git, fixtures, logs or reports). Nothing here prints or embeds a secret value:
 * secrets are wrapped in `SecretValue`, whose string/JSON/inspect forms are redacted, and loader errors name the
 * variable, never its value.
 *
 * | Variable | Bundle | Meaning |
 * |---|---|---|
 * | `GEO_GOOGLE_API_KEY` | S1 | server key (Places API (New), Geocoding API, Routes API) — evaluation project only (FA-06) |
 * | `GEO_GOOGLE_ROUTES_TRAFFIC_AWARE` | S1 | `true` ⇒ `TRAFFIC_AWARE` routing (billed at the higher Routes tier); default `false` |
 * | `GEO_MAPBOX_ACCESS_TOKEN` | S2 | server token (Search Box, Geocoding v6 temporary, Directions) |
 * | `GEO_PHOTON_URL` | S3 | self-hosted Photon base URL |
 * | `GEO_NOMINATIM_URL` | S3 | self-hosted Nominatim base URL (reverse + id lookup) |
 * | `GEO_OSRM_URL` | S3 | self-hosted OSRM base URL |
 * | `GEO_VALHALLA_URL` | S3 | self-hosted Valhalla base URL |
 *
 * Base URLs must be https, except plain http to a loopback or RFC 1918 private address for local self-hosted
 * benchmarks. The public Nominatim/OSM/Photon/OSRM demo servers are refused (usage policies; founder decision).
 */
import { inspect } from 'node:util';
import { z } from 'zod';
import { GeoAdapterConfigError } from './errors.js';

export type GeoEnv = Readonly<Record<string, string | undefined>>;

/** Opaque wrapper so a credential never reaches a log line, JSON body or error message by accident. */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The raw value, for the single place that puts it into an outbound request. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return 'SecretValue([REDACTED])';
  }
}

/** Opaque provider key (e.g. `geo-a`): the vendor mapping lives only in configuration/ADR-006, never in results. */
const PROVIDER_KEY = /^[a-z][a-z0-9-]{1,31}$/;

export function assertProviderKey(providerKey: string): string {
  if (!PROVIDER_KEY.test(providerKey)) throw new GeoAdapterConfigError('providerKey must match ^[a-z][a-z0-9-]{1,31}$');
  return providerKey;
}

/** Public endpoints whose usage policies forbid Wayvro's use (autocomplete / systematic reverse / no SLA). */
const REFUSED_PUBLIC_HOSTS = new Set([
  'nominatim.openstreetmap.org',
  'photon.komoot.io',
  'router.project-osrm.org',
  'valhalla1.openstreetmap.de',
  'tile.openstreetmap.org',
]);

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Validates a self-hosted base URL; returns it with a trailing slash so endpoint paths resolve beneath it. */
export function parseBaseUrl(variable: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GeoAdapterConfigError(`${variable} is not a valid URL`);
  }
  if (url.username !== '' || url.password !== '') throw new GeoAdapterConfigError(`${variable} must not contain credentials`);
  if (url.search !== '' || url.hash !== '') throw new GeoAdapterConfigError(`${variable} must not contain a query or fragment`);
  if (REFUSED_PUBLIC_HOSTS.has(url.hostname.toLowerCase())) {
    throw new GeoAdapterConfigError(`${variable} points at a public community server; only self-hosted instances are allowed`);
  }
  if (url.protocol === 'http:') {
    if (!isPrivateOrLoopbackHost(url.hostname)) throw new GeoAdapterConfigError(`${variable} must use https unless it targets a loopback/private address`);
  } else if (url.protocol !== 'https:') {
    throw new GeoAdapterConfigError(`${variable} must use https`);
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

function optional(env: GeoEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function bool(env: GeoEnv, name: string): boolean {
  const value = optional(env, name);
  if (value === null || value === 'false') return false;
  if (value === 'true') return true;
  throw new GeoAdapterConfigError(`${name} must be "true" or "false"`);
}

const GOOGLE_KEY = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
const MAPBOX_TOKEN = z.string().regex(/^(pk|sk)\.[A-Za-z0-9._-]{20,2000}$/);

export interface GoogleGeoConfig {
  readonly apiKey: SecretValue;
  /** `TRAFFIC_AWARE` routing (higher-priced Routes tier); default false = `TRAFFIC_UNAWARE` (Essentials). */
  readonly routesTrafficAware: boolean;
}

/** `null` when S1 is not configured (no key). Throws when a key is present but malformed. */
export function readGoogleGeoConfig(env: GeoEnv): GoogleGeoConfig | null {
  const key = optional(env, 'GEO_GOOGLE_API_KEY');
  if (key === null) return null;
  if (!GOOGLE_KEY.safeParse(key).success) throw new GeoAdapterConfigError('GEO_GOOGLE_API_KEY has an invalid format');
  return { apiKey: new SecretValue(key), routesTrafficAware: bool(env, 'GEO_GOOGLE_ROUTES_TRAFFIC_AWARE') };
}

export interface MapboxGeoConfig {
  readonly accessToken: SecretValue;
}

/** `null` when S2 is not configured. Throws when a token is present but malformed. */
export function readMapboxGeoConfig(env: GeoEnv): MapboxGeoConfig | null {
  const token = optional(env, 'GEO_MAPBOX_ACCESS_TOKEN');
  if (token === null) return null;
  if (!MAPBOX_TOKEN.safeParse(token).success) throw new GeoAdapterConfigError('GEO_MAPBOX_ACCESS_TOKEN has an invalid format');
  return { accessToken: new SecretValue(token) };
}

export interface OpenStackGeoConfig {
  readonly photonUrl: URL | null;
  readonly nominatimUrl: URL | null;
  readonly osrmUrl: URL | null;
  readonly valhallaUrl: URL | null;
}

/** Every S3 component is optional; each present URL is validated (self-hosted only). */
export function readOpenStackGeoConfig(env: GeoEnv): OpenStackGeoConfig {
  const url = (name: string): URL | null => {
    const value = optional(env, name);
    return value === null ? null : parseBaseUrl(name, value);
  };
  return {
    photonUrl: url('GEO_PHOTON_URL'),
    nominatimUrl: url('GEO_NOMINATIM_URL'),
    osrmUrl: url('GEO_OSRM_URL'),
    valhallaUrl: url('GEO_VALHALLA_URL'),
  };
}
