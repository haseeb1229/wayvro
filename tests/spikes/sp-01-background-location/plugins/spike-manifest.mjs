/*
 * SP-01 spike-only manifest adjustments (never used by apps/wayvro-mobile).
 *
 * 1. No automatic resume at boot or after an update (protocol TC-09, role model §6): expo-task-manager's
 *    TaskBroadcastReceiver listens for BOOT_COMPLETED and MY_PACKAGE_REPLACED and then restores persisted tasks, which
 *    for expo-location means restarting location updates and the foreground service without a user action. The
 *    receiver is redeclared with tools:node="replace" keeping only its own internal action; RECEIVE_BOOT_COMPLETED is
 *    also blocked in app.json. check-spike-manifest.mjs verifies both on the built artefact.
 * 2. Cleartext HTTP to the private-LAN receiver: the spike talks to a Node process on the founder's laptop
 *    (protocol §5.4) over plain HTTP. Only metadata travels (no coordinates, §5.2) with a spike-local-only token.
 *    This applies to the disposable spike ONLY; the release app never enables cleartext (CLAUDE.md §11).
 * 3. No URL scheme: prebuild's template leaves an `exp+<slug>` VIEW/BROWSABLE intent filter on MainActivity although
 *    the spike has no dev client and no deep links; it is removed so the spike exports only its launcher activity
 *    (same posture as the release app, F-P3-01).
 */
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { AndroidConfig, withAndroidManifest } = configPlugins;

const TASK_RECEIVER = 'expo.modules.taskManager.TaskBroadcastReceiver';
const TASK_RECEIVER_ACTION = 'expo.modules.taskManager.TaskBroadcastReceiver.INTENT_ACTION';

export default function withSpikeManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$ = { ...manifest.manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.$['android:usesCleartextTraffic'] = 'true';
    for (const activity of app.activity ?? []) {
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(
        (f) => !(f.data ?? []).some((d) => String(d.$?.['android:scheme'] ?? '').startsWith('exp+')),
      );
    }
    app.receiver = (app.receiver ?? []).filter((r) => r.$?.['android:name'] !== TASK_RECEIVER);
    app.receiver.push({
      $: { 'android:name': TASK_RECEIVER, 'android:exported': 'false', 'tools:node': 'replace' },
      'intent-filter': [{ action: [{ $: { 'android:name': TASK_RECEIVER_ACTION } }] }],
    });
    return cfg;
  });
}
