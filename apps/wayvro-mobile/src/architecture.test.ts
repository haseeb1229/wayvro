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

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => join(dir, f));
const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const importsOf = (code: string): string[] => [...code.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
const production = sourceFiles(SRC).filter((f) => !/\.test\.tsx?$/.test(f) && !rel(f).startsWith('__mocks__/'));

describe('architecture guards', () => {
  it('package.json declares no AsyncStorage or other plain key/value storage', () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const deps = Object.keys({ ...pkg['dependencies'], ...pkg['devDependencies'] });
    expect(deps.filter((d) => /async-storage|mmkv|react-native-default-preference/i.test(d))).toEqual([]);
  });

  it('only the SecureTokenStore module imports expo-secure-store, and nothing imports AsyncStorage', () => {
    const importers = sourceFiles(SRC).filter((f) => importsOf(readFileSync(f, 'utf8')).includes('expo-secure-store'));
    expect(importers.map(rel)).toEqual(['core/session/secure-token-store.ts']);
    // No biometric-gated items: the biometric permissions are blocked in app.config.ts (no prompt exists).
    expect(readFileSync(join(SRC, 'core/session/secure-token-store.ts'), 'utf8')).not.toMatch(/requireAuthentication/);
    for (const file of sourceFiles(SRC))
      expect(
        importsOf(readFileSync(file, 'utf8')).some((m) => /async-storage/i.test(m)),
        rel(file),
      ).toBe(false);
  });

  it('production code never logs (tokens, phone numbers and codes must not reach logs)', () => {
    for (const file of production) expect(/\bconsole\.\w+\(/.test(readFileSync(file, 'utf8')), rel(file)).toBe(false);
  });

  it('the routes directory holds only thin route files (no tests, helpers or logic modules)', () => {
    for (const file of sourceFiles(join(SRC, 'app'))) {
      expect(file.endsWith('.tsx'), rel(file)).toBe(true);
      const code = readFileSync(file, 'utf8');
      expect(/export default/.test(code), rel(file)).toBe(true);
      expect(code.split('\n').length, rel(file)).toBeLessThan(25);
    }
  });

  it('no module requests location, media-library, notification or background capabilities', () => {
    const forbidden = /^(expo-location|expo-media-library|expo-notifications|expo-task-manager|expo-background-fetch|react-native-maps)/;
    for (const file of production) for (const m of importsOf(readFileSync(file, 'utf8'))) expect(forbidden.test(m), `${rel(file)} imports ${m}`).toBe(false);
  });

  it('camera, image picker and file system are used ONLY inside the Driver/Partner feature (P2.8, just-in-time capture)', () => {
    const driverOnly = /^(expo-camera|expo-image-picker|expo-file-system)(\/|$)/;
    const users = production.filter((file) => importsOf(readFileSync(file, 'utf8')).some((m) => driverOnly.test(m))).map(rel);
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) expect(file.startsWith('features/driver/'), file).toBe(true);
  });

  it('routes load Driver/Partner screens lazily, so rider-only start-up never evaluates camera or file-system code', () => {
    for (const file of sourceFiles(join(SRC, 'app'))) {
      const code = readFileSync(file, 'utf8');
      for (const m of importsOf(code).filter((i) => i.includes('features/driver/'))) {
        expect(code.includes(`import('${m}')`), `${rel(file)} must import ${m} lazily`).toBe(true);
        expect(code.includes('lazyScreen('), rel(file)).toBe(true);
      }
    }
    // Core reaches the Driver/Partner module only through a dynamic import (the sign-out wipe of local evidence).
    for (const file of production.filter((f) => rel(f).startsWith('core/'))) {
      expect(/from\s+['"][^'"]*features\/driver\//.test(readFileSync(file, 'utf8')), rel(file)).toBe(false);
    }
  });

  it('evidence queue metadata goes through the secure KeyValueStore port, never a second storage module', () => {
    const queueStore = readFileSync(join(SRC, 'features/driver/upload/queue-store.ts'), 'utf8');
    expect(queueStore).toMatch(/STORAGE_KEYS\.evidenceQueue/);
    expect(importsOf(queueStore).some((m) => /secure-store|file-system|async-storage/.test(m))).toBe(false);
  });

  it('rider and driver feature modules stay isolated from each other and from the account slice internals', () => {
    expect(production.some((f) => rel(f).startsWith('features/driver/'))).toBe(true);
    for (const file of production.filter((f) => /features\/(rider|driver)\//.test(rel(f)))) {
      for (const m of importsOf(readFileSync(file, 'utf8'))) expect(/features\/(rider|driver|account)\//.test(m), `${rel(file)} imports ${m}`).toBe(false);
    }
  });
});
