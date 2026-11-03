import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCATION_TASK_SERVICE, removeLocationTaskService } from '../../../plugins/no-location-task-service.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('P3.5 foreground-only location: no LocationTaskService in the merged manifest', () => {
  it('adds a tools:node="remove" entry for the expo-location service (and the tools namespace)', () => {
    const manifest = { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, application: [{ $: {} }] } };
    const out = removeLocationTaskService(manifest);
    expect(out.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    expect(out.manifest.application[0].service).toEqual([{ $: { 'android:name': LOCATION_TASK_SERVICE, 'tools:node': 'remove' } }]);
    // Idempotent: a second prebuild pass does not add a duplicate entry.
    expect(removeLocationTaskService(out).manifest.application[0].service).toHaveLength(1);
  });

  // Source scan of every app file: explicit timeout like the i18n audit (slow on a loaded machine).
  it('the app never calls the background-update APIs that would start that service', { timeout: 30_000 }, () => {
    const offenders = sourceFiles(SRC).filter((f) => /startLocationUpdatesAsync|startGeofencingAsync|expo-task-manager/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
