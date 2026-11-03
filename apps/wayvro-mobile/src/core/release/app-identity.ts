import { APP_BUILD_HEADER, APP_PLATFORM_HEADER, APP_VERSION_HEADER, AppBuildHeaderSchema, AppVersionHeaderSchema } from '@wayvro/contracts';

/**
 * Which binary is running (A01/Q31; ADR-049). Platform from React Native's `Platform.OS`; version and native build
 * number from the embedded Expo config (`expoConfig.version`, `android.versionCode`, `ios.buildNumber`, all written by
 * app.config.ts from WAYVRO_BUILD_NUMBER). No new dependency (expo-application) is needed. These are compatibility
 * HINTS for the server's version policy, never an authorisation input; a value that does not match the contract shape
 * is omitted rather than guessed (a guessed build could wrongly block or unblock the app).
 */
export interface AppIdentity {
  readonly platform: 'ANDROID' | 'IOS';
  /** Marketing version; '0.0.0' when the embedded value is missing or malformed (existing session-device rule). */
  readonly version: string;
  /** Monotonic native build number, or null when unknown (the build header is then omitted). */
  readonly build: number | null;
}

/** The fields of the embedded Expo config this module reads (structural, so tests need no Expo runtime). */
export interface EmbeddedConfig {
  readonly version?: string;
  readonly android?: { readonly versionCode?: number };
  readonly ios?: { readonly buildNumber?: string };
}

export function appIdentity(os: string, config: EmbeddedConfig | null | undefined): AppIdentity {
  const platform = os === 'ios' ? 'IOS' : 'ANDROID';
  const versionParsed = AppVersionHeaderSchema.safeParse(config?.version);
  const rawBuild = platform === 'IOS' ? config?.ios?.buildNumber : config?.android?.versionCode === undefined ? undefined : String(config.android.versionCode);
  const buildParsed = AppBuildHeaderSchema.safeParse(rawBuild);
  return {
    platform,
    version: versionParsed.success ? versionParsed.data : '0.0.0',
    build: buildParsed.success ? Number(buildParsed.data) : null,
  };
}

/** Headers for every API request (lower-case names, as the contract defines them). */
export function appHeaders(identity: AppIdentity): Readonly<Record<string, string>> {
  return {
    [APP_PLATFORM_HEADER]: identity.platform,
    [APP_VERSION_HEADER]: identity.version,
    ...(identity.build === null ? {} : { [APP_BUILD_HEADER]: String(identity.build) }),
  };
}
