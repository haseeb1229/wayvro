/**
 * Candidate A permission coupling (found in the 2026-10-16 LOCAL_EMULATOR_SUPPLEMENTARY run, API 35): expo-task-manager
 * delivers every location batch through a PERSISTED JobScheduler job, and JobScheduler throws
 * `IllegalArgumentException: Requested job cannot be persisted without holding RECEIVE_BOOT_COMPLETED` otherwise — the
 * spike process crashed on its first location callback while the permission was blocked. These tests keep the spike
 * config consistent with the installed library, and keep the "no boot receiver" rule (TC-09) separate from the
 * permission: the boot/package-replaced ACTIONS stay stripped and forbidden.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOT = 'android.permission.RECEIVE_BOOT_COMPLETED';
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

type AppJson = { expo: { android: { permissions: string[]; blockedPermissions: string[] } } };
type Policy = { allowed: { name: string }[]; forbidden: { name: string }[] };

const persistsJobs = /\.setPersisted\(true\)/.test(
  read('node_modules/expo-task-manager/android/src/main/java/expo/modules/taskManager/TaskManagerUtils.java'),
);

describe('candidate A: expo-task-manager persisted jobs vs RECEIVE_BOOT_COMPLETED', () => {
  it('the installed expo-task-manager still persists its jobs (if this fails, re-evaluate whether the permission is still needed)', () => {
    assert.equal(persistsJobs, true);
  });

  it('app.json declares RECEIVE_BOOT_COMPLETED and does not block it while jobs are persisted', () => {
    const app = JSON.parse(read('app.json')) as AppJson;
    assert.ok(app.expo.android.permissions.includes(BOOT), 'RECEIVE_BOOT_COMPLETED must be declared');
    assert.ok(!app.expo.android.blockedPermissions.includes(BOOT), 'blocking it crashes the spike on the first location callback');
  });

  it('the spike allowlist allows it and does not also forbid it', () => {
    const policy = JSON.parse(read('spike-permission-allowlist.json')) as Policy;
    assert.ok(policy.allowed.some((p) => p.name === BOOT));
    assert.ok(!policy.forbidden.some((p) => p.name === BOOT));
  });

  it('there is still no boot receiver: boot/package-replaced actions are stripped and the artefact check forbids them', () => {
    const plugin = read('plugins/spike-manifest.mjs');
    assert.match(plugin, /'tools:node': 'replace'/);
    assert.match(plugin, /TaskBroadcastReceiver\.INTENT_ACTION/);
    assert.doesNotMatch(plugin, /android\.intent\.action\.(BOOT_COMPLETED|MY_PACKAGE_REPLACED)/);
    const check = read('check-spike-manifest.mjs');
    for (const action of ['android.intent.action.BOOT_COMPLETED', 'android.intent.action.LOCKED_BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED'])
      assert.ok(check.includes(`'${action}'`), `${action} must stay a forbidden receiver action`);
  });
});
