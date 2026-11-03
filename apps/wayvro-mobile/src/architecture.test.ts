import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static guards for the storage and structure rules (Q01, CLAUDE.md §3/§9/§11): tokens only in OS secure storage, one
 * module owning expo-secure-store, no AsyncStorage, a routes directory with only route files, sensitive device modules
 * (camera, picker, file system) confined to the lazily loaded Driver/Partner feature, and rider/driver isolation.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SRC, '..');

// Every guard scans the whole source tree; walking and reading each file once per run (instead of once per guard)
// keeps the suite well inside the default test timeout as the app grows. Same files, same assertions.
const listings = new Map<string, string[]>();
const sourceFiles = (dir: string): string[] => {
  let files = listings.get(dir);
  if (!files) {
    files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(dir, f));
    listings.set(dir, files);
  }
  return files;
};
const contents = new Map<string, string>();
const read = (file: string): string => {
  let code = contents.get(file);
  if (code === undefined) {
    code = readFileSync(file, 'utf8');
    contents.set(file, code);
  }
  return code;
};
const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const importsOf = (code: string): string[] => [...code.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
const production = sourceFiles(SRC).filter((f) => !/\.test\.tsx?$/.test(f) && !rel(f).startsWith('__mocks__/'));

describe('architecture guards', () => {
  it('package.json declares no AsyncStorage or other plain key/value storage', () => {
    const pkg = JSON.parse(read(join(APP_ROOT, 'package.json'))) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg['dependencies'], ...pkg['devDependencies'] });
    expect(deps.filter((d) => /async-storage|mmkv|react-native-default-preference/i.test(d))).toEqual([]);
  });

  it('only the SecureTokenStore module imports expo-secure-store, and nothing imports AsyncStorage', () => {
    const importers = sourceFiles(SRC).filter((f) => importsOf(read(f)).includes('expo-secure-store'));
    expect(importers.map(rel)).toEqual(['core/session/secure-token-store.ts']);
    // No biometric-gated items: the biometric permissions are blocked in app.config.ts (no prompt exists).
    expect(read(join(SRC, 'core/session/secure-token-store.ts'))).not.toMatch(/requireAuthentication/);
    for (const file of sourceFiles(SRC))
      expect(
        importsOf(read(file)).some((m) => /async-storage/i.test(m)),
        rel(file),
      ).toBe(false);
  });

  it('production code never logs (tokens, phone numbers and codes must not reach logs)', () => {
    for (const file of production) expect(/\bconsole\.\w+\(/.test(read(file)), rel(file)).toBe(false);
  });

  it('the routes directory holds only thin route files (no tests, helpers or logic modules)', () => {
    for (const file of sourceFiles(join(SRC, 'app'))) {
      expect(file.endsWith('.tsx'), rel(file)).toBe(true);
      const code = read(file);
      // `+native-intent` is Expo Router's system-path hook (not a route): it only re-exports the bounded intent parser.
      if (rel(file) === 'app/+native-intent.tsx') expect(/export \{ redirectSystemPath \} from '\.\.\/core\/intents\/native-intent';/.test(code)).toBe(true);
      else expect(/export default/.test(code), rel(file)).toBe(true);
      expect(code.split('\n').length, rel(file)).toBeLessThan(25);
    }
  });

  it('no module requests media-library, notification, background-task, map or animation capabilities', () => {
    const forbidden =
      /^(expo-media-library|expo-notifications|expo-task-manager|expo-background-fetch|react-native-maps|react-native-reanimated|react-native-gesture-handler)(\/|$)/;
    for (const file of production) for (const m of importsOf(read(file))) expect(forbidden.test(m), `${rel(file)} imports ${m}`).toBe(false);
  });

  it('P3.5 (FA-02 scope): expo-location is imported ONLY under src/platform/location/, and no background/geofence/FGS API appears anywhere', () => {
    const importers = production.filter((f) => importsOf(read(f)).some((m) => /^expo-location(\/|$)/.test(m))).map(rel);
    expect(importers.sort()).toEqual(['platform/location/request.ts', 'platform/location/status.ts']);
    const banned =
      /\b(requestBackgroundPermissionsAsync|startLocationUpdatesAsync|startGeofencingAsync|hasStartedLocationUpdatesAsync|enableNetworkProviderAsync)\b/;
    for (const file of production) expect(banned.test(read(file)), rel(file)).toBe(false);
  });

  it('P3.5: the location module has two entry points — Driver/Partner may import only the read-only `status`; core imports neither', () => {
    const locationImports = (file: string): string[] => importsOf(read(file)).filter((m) => m.includes('platform/location/'));
    for (const file of production.filter((f) => rel(f).startsWith('features/driver/')))
      for (const m of locationImports(file)) expect(m.endsWith('platform/location/status'), `${rel(file)} imports ${m}`).toBe(true);
    for (const file of production.filter((f) => rel(f).startsWith('core/'))) expect(locationImports(file), rel(file)).toEqual([]);
    // Driver/Partner screens may read the permission state; they never request it.
    for (const file of production.filter((f) => rel(f).startsWith('features/driver/')))
      expect(/requestForeground|currentFix|watchPickupFix/.test(read(file)), rel(file)).toBe(false);
  });

  it('P3.5: layouts never import the Driver/Partner feature (they are evaluated at start-up), and /drive screens are lazy', () => {
    for (const file of sourceFiles(join(SRC, 'app')).filter((f) => f.endsWith('_layout.tsx'))) {
      expect(
        importsOf(read(file)).some((m) => m.includes('features/driver')),
        rel(file),
      ).toBe(false);
    }
    const driveRoutes = sourceFiles(join(SRC, 'app/(session)/drive')).filter((f) => !f.endsWith('_layout.tsx'));
    expect(driveRoutes.length).toBeGreaterThanOrEqual(4);
    for (const file of driveRoutes) expect(read(file).includes('lazyScreen(() => import('), rel(file)).toBe(true);
  });

  it('P3.5: core/mode, core/intents and core/release import nothing from features/*', () => {
    for (const file of production.filter((f) => /^core\/(mode|intents|release|lite)\//.test(rel(f))))
      for (const m of importsOf(read(file))) expect(m.includes('features/'), `${rel(file)} imports ${m}`).toBe(false);
  });

  it('P3.5: rider screens hold no hard-coded user-facing text and no product-code business rules', () => {
    // Negative controls: the scans below do catch literal copy and product-code rules.
    // `(?<!=)` skips arrow functions (`=>`) whose body starts with a generic call.
    const literalJsxText = /(?<!=)>\s*[A-Za-z][A-Za-z ,.'!?]{2,}\s*</;
    expect(literalJsxText.test('<Text>Book a ride</Text>')).toBe(true);
    expect(literalJsxText.test('<Text>\n  Book a ride\n</Text>')).toBe(true);
    expect(literalJsxText.test('() =>\n  new Thing<T>()')).toBe(false);
    expect(/\b(label|title|text|detail)=["'][A-Za-z]/.test('<Button label="Continue" />')).toBe(true);
    expect(/'(ECONOMY|COMFORT|BIKE|RICKSHAW)'/.test("case 'ECONOMY':")).toBe(true);
    const screens = production.filter(
      (f) =>
        (rel(f).startsWith('features/rider/') || /features\/driver\/screens\/Drive(Home|Eligibility|Health|Location)Screen/.test(rel(f))) && f.endsWith('.tsx'),
    );
    expect(screens.length).toBeGreaterThan(0);
    for (const file of screens) {
      const code = read(file);
      // JSX text children and string-literal labels must come from the typed catalogues.
      expect(literalJsxText.test(code), `${rel(file)} has literal JSX text`).toBe(false);
      expect(/\b(label|title|text|detail)=["'][A-Za-z]/.test(code), `${rel(file)} has a literal label`).toBe(false);
      expect(/'(ECONOMY|COMFORT|BIKE|RICKSHAW)'/.test(code), `${rel(file)} switches on product codes`).toBe(false);
    }
  });

  it('camera, image picker and file system are used ONLY inside the Driver/Partner feature (P2.8, just-in-time capture)', () => {
    const driverOnly = /^(expo-camera|expo-image-picker|expo-file-system)(\/|$)/;
    const users = production.filter((file) => importsOf(read(file)).some((m) => driverOnly.test(m))).map(rel);
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) expect(file.startsWith('features/driver/'), file).toBe(true);
  });

  it('routes load Driver/Partner screens lazily, so rider-only start-up never evaluates camera or file-system code', () => {
    for (const file of sourceFiles(join(SRC, 'app'))) {
      const code = read(file);
      for (const m of importsOf(code).filter((i) => i.includes('features/driver/'))) {
        expect(code.includes(`import('${m}')`), `${rel(file)} must import ${m} lazily`).toBe(true);
        expect(code.includes('lazyScreen('), rel(file)).toBe(true);
      }
    }
    // Core reaches the Driver/Partner module only through a dynamic import (the sign-out wipe of local evidence).
    for (const file of production.filter((f) => rel(f).startsWith('core/'))) {
      expect(/from\s+['"][^'"]*features\/driver\//.test(read(file)), rel(file)).toBe(false);
    }
  });

  it('evidence queue metadata goes through the secure KeyValueStore port, never a second storage module', () => {
    const queueStore = read(join(SRC, 'features/driver/upload/queue-store.ts'));
    expect(queueStore).toMatch(/STORAGE_KEYS\.evidenceQueue/);
    expect(importsOf(queueStore).some((m) => /secure-store|file-system|async-storage/.test(m))).toBe(false);
  });

  it('rider and driver feature modules stay isolated from each other and from the account slice internals', () => {
    expect(production.some((f) => rel(f).startsWith('features/driver/'))).toBe(true);
    for (const file of production.filter((f) => /features\/(rider|driver)\//.test(rel(f)))) {
      for (const m of importsOf(read(file))) expect(/features\/(rider|driver|account)\//.test(m), `${rel(file)} imports ${m}`).toBe(false);
    }
  });
});
