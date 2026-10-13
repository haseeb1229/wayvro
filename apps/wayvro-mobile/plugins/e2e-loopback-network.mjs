/*
 * SP-08 E2E VARIANT ONLY (ADR-052): lets the debug-signed, release-mode E2E APK reach the API local runner on the
 * Android emulator's host loopback alias (10.0.2.2) over plain http — and nothing else. app.config.ts adds this plugin
 * only while WAYVRO_E2E_API_PORT is set, which `node scripts/android-build.mjs e2e` does and `release` mode refuses.
 *
 * It writes one network security config: cleartext is denied for every host (base-config) and permitted for exactly
 * the emulator loopback host (domain-config, no subdomains); no user-installed CA is trusted. The release-purity gate
 * (infra/ci/android/check-release-purity.mjs) proves the release AAB has no networkSecurityConfig attribute, no
 * usesCleartextTraffic="true", no resource of this name and no E2E marker in its embedded app config.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// expo/config-plugins has no ESM exports map: Node needs the file path (a CommonJS re-export of @expo/config-plugins).
import configPlugins from 'expo/config-plugins.js';

const { withAndroidManifest, withDangerousMod } = configPlugins;

const E2E_NETWORK_CONFIG_NAME = 'wayvro_e2e_network_security';
const EMULATOR_LOOPBACK_HOST = '10.0.2.2';

const NETWORK_SECURITY_XML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- SP-08 E2E variant only (ADR-052): cleartext to the emulator host loopback alias, nothing else. -->',
  '<network-security-config>',
  '  <base-config cleartextTrafficPermitted="false">',
  '    <trust-anchors>',
  '      <certificates src="system" />',
  '    </trust-anchors>',
  '  </base-config>',
  '  <domain-config cleartextTrafficPermitted="true">',
  `    <domain includeSubdomains="false">${EMULATOR_LOOPBACK_HOST}</domain>`,
  '  </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

export default function withE2eLoopbackNetwork(config) {
  const withManifest = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) throw new Error('e2e-loopback-network: the Android manifest has no <application> element');
    application.$['android:networkSecurityConfig'] = `@xml/${E2E_NETWORK_CONFIG_NAME}`;
    return cfg;
  });
  return withDangerousMod(withManifest, [
    'android',
    async (cfg) => {
      const dir = join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${E2E_NETWORK_CONFIG_NAME}.xml`), NETWORK_SECURITY_XML);
      return cfg;
    },
  ]);
}
