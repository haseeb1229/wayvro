#!/usr/bin/env node
/*
 * Wayvro Android release exported-component / intent-filter gate (F-P3-01; ADR-043; CLAUDE.md §9). Node >= 18, no npm
 * dependencies. Dumps the merged base manifest of an AAB with bundletool and compares every application component
 * (activity, activity-alias, service, receiver, provider) against infra/ci/android/component-allowlist.json:
 *  - an exported component (android:exported="true", or an intent filter without an explicit exported attribute) must be
 *    allowlisted with exactly its permission and intent filters;
 *  - no application intent filter may carry a <data> element (scheme/host/path/mimeType) or the BROWSABLE category, so
 *    no external URL scheme (e.g. the expo-dev-client `exp+<slug>`) and no app/universal link reaches a release build.
 *  - no service may declare android:foregroundServiceType unless component-allowlist.json `foregroundServices` lists it:
 *    Phase 3 has no foreground service (P3.5 / FA-02: foreground-only Rider location), so e.g. expo-location's
 *    LocationTaskService (type location) must be removed from the release merged manifest
 *    (apps/wayvro-mobile/plugins/no-location-task-service.mjs).
 * <queries> entries (package-visibility declarations, not handlers) are ignored.
 *
 * Usage: node infra/ci/android/check-intent-filters.mjs --aab app-release.aab --bundletool bundletool-all.jar [--report out.json]
 *        node infra/ci/android/check-intent-filters.mjs --self-test   (negative/positive controls on fixture manifests)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENT_TAGS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);

/** Minimal XML element tree (bundletool output: well-formed, no CDATA/DTD). Comments and declarations are skipped. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = tag.exec(xml)) !== null) {
    if (m[2] === undefined) continue;
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`malformed manifest: unexpected </${name}>`);
      continue;
    }
    const attrs = {};
    for (const a of (rawAttrs ?? '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error('malformed manifest: unclosed elements');
  return root;
}

const childrenNamed = (node, name) => node.children.filter((c) => c.name === name);
const sorted = (xs) => [...xs].sort();
const filterKey = (f) => `${sorted(f.actions).join(',')}|${sorted(f.categories).join(',')}`;

/** Checks one merged manifest string against the allowlist; returns { applicationId, components, problems }. */
export function checkManifest(xml, policy) {
  const manifest = childrenNamed(parseXml(xml), 'manifest')[0];
  if (!manifest) throw new Error('no <manifest> element');
  const applicationId = manifest.attrs['package'];
  if (!applicationId) throw new Error('could not read package name from manifest');
  const sub = (n) => n.replace('${applicationId}', applicationId);
  const allowed = new Map(policy.exported.map((e) => [`${e.kind}:${sub(e.name)}`, e]));
  const allowedFgs = new Set((policy.foregroundServices ?? []).map((e) => sub(e.name)));
  const components = [];
  const problems = [];
  for (const application of childrenNamed(manifest, 'application')) {
    for (const c of application.children) {
      if (!COMPONENT_TAGS.has(c.name)) continue;
      const name = c.attrs['android:name'] ?? '(unnamed)';
      const filters = childrenNamed(c, 'intent-filter').map((f) => ({
        actions: childrenNamed(f, 'action').map((a) => a.attrs['android:name'] ?? ''),
        categories: childrenNamed(f, 'category').map((a) => a.attrs['android:name'] ?? ''),
        data: childrenNamed(f, 'data').map((d) => d.attrs),
      }));
      const exportedAttr = c.attrs['android:exported'];
      // Without an explicit attribute a component with an intent filter is exported on older targets: fail safe.
      const exported = exportedAttr === 'true' || (exportedAttr === undefined && filters.length > 0);
      const id = `${c.name}:${name}`;
      components.push({ id, exported, permission: c.attrs['android:permission'] ?? null, filters });
      for (const f of filters) {
        for (const d of f.data) problems.push(`DATA ${id}: intent filter declares <data ${JSON.stringify(d)}> (no external scheme/link in release)`);
        if (f.categories.includes('android.intent.category.BROWSABLE')) problems.push(`BROWSABLE ${id}: browsable intent filter in a release build`);
      }
      const fgsType = c.attrs['android:foregroundServiceType'];
      if (c.name === 'service' && fgsType !== undefined && !allowedFgs.has(name))
        problems.push(`FOREGROUND-SERVICE ${id}: declares foregroundServiceType=${fgsType}; not in component-allowlist.json foregroundServices`);
      if (!exported) continue;
      const entry = allowed.get(id);
      if (!entry) {
        problems.push(`UNLISTED-EXPORTED ${id}: exported component not in component-allowlist.json`);
        continue;
      }
      if ((entry.permission ?? null) !== (c.attrs['android:permission'] ?? null))
        problems.push(`PERMISSION ${id}: expected ${String(entry.permission ?? null)}, found ${String(c.attrs['android:permission'] ?? null)}`);
      const expected = sorted(entry.intentFilters.map(filterKey));
      const actual = sorted(filters.map(filterKey));
      if (JSON.stringify(expected) !== JSON.stringify(actual))
        problems.push(`FILTERS ${id}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`);
    }
  }
  return { applicationId, components, problems };
}

const policyFile = () => JSON.parse(readFileSync(join(HERE, 'component-allowlist.json'), 'utf8'));

/** Fixture manifests: the expected release shape must pass; each known-bad variant must fail. */
function selfTest() {
  const policy = policyFile();
  const app = (body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.wayvro.app">\n<queries><intent><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https"/></intent></queries>\n<application android:name="dev.wayvro.app.MainApplication">${body}</application>\n</manifest>\n`;
  const main = (extra = '') =>
    `<activity android:exported="true" android:name="dev.wayvro.app.MainActivity"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>${extra}</activity>`;
  const profile = (perm = ' android:permission="android.permission.DUMP"') =>
    `<receiver android:exported="true" android:name="androidx.profileinstaller.ProfileInstallReceiver"${perm}>` +
    ['INSTALL_PROFILE', 'SKIP_FILE', 'SAVE_PROFILE', 'BENCHMARK_OPERATION']
      .map((a) => `<intent-filter><action android:name="androidx.profileinstaller.action.${a}"/></intent-filter>`)
      .join('') +
    `</receiver>`;
  const hidden = `<service android:enabled="false" android:exported="false" android:name="com.google.android.gms.metadata.ModuleDependencies"><intent-filter><action android:name="com.google.android.gms.metadata.MODULE_DEPENDENCIES"/></intent-filter></service>`;
  const cases = [
    { name: 'expected release shape', xml: app(main() + profile() + hidden), pass: true },
    {
      name: 'expo-dev-client exp+wayvro scheme (F-P3-01)',
      xml: app(
        main(
          '<intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="exp+wayvro"/></intent-filter>',
        ) + profile(),
      ),
      pass: false,
    },
    {
      name: 'extra exported receiver',
      xml: app(
        main() +
          profile() +
          '<receiver android:exported="true" android:name="com.example.Leak"><intent-filter><action android:name="com.example.PING"/></intent-filter></receiver>',
      ),
      pass: false,
    },
    {
      name: 'https app link on an alias',
      xml: app(
        main() +
          profile() +
          '<activity-alias android:exported="true" android:name="dev.wayvro.app.Link" android:targetActivity="dev.wayvro.app.MainActivity"><intent-filter android:autoVerify="true"><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="https" android:host="wayvro.example"/></intent-filter></activity-alias>',
      ),
      pass: false,
    },
    {
      name: 'implicit export via intent filter',
      xml: app(
        main() + profile() + '<service android:name="com.example.Implicit"><intent-filter><action android:name="com.example.X"/></intent-filter></service>',
      ),
      pass: false,
    },
    { name: 'profile installer without its permission', xml: app(main() + profile('')), pass: false },
    {
      name: 'non-exported location foreground service (expo-location LocationTaskService)',
      xml: app(
        main() +
          profile() +
          '<service android:exported="false" android:foregroundServiceType="location" android:name="expo.modules.location.services.LocationTaskService"/>',
      ),
      pass: false,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const { problems } = checkManifest(c.xml, policy);
    const ok = (problems.length === 0) === c.pass;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${problems.length === 0 ? 'no problems' : problems.join(' | ')}`);
  }
  console.log(`INTENT-FILTER GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)`);
  return failed === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') process.exit(selfTest() ? 0 : 1);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
  if (!args.aab || !args.bundletool) {
    console.error('usage: --aab <file> --bundletool <jar> [--report <json>] | --self-test');
    process.exit(2);
  }
  const xml = execFileSync('java', ['-jar', args.bundletool, 'dump', 'manifest', `--bundle=${args.aab}`], { encoding: 'utf8' });
  const { applicationId, components, problems } = checkManifest(xml, policyFile());
  const exported = components.filter((c) => c.exported).map((c) => c.id);
  const report = { applicationId, exported, components, result: problems.length ? 'FAIL' : 'PASS', problems };
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  console.log(`package: ${applicationId}`);
  console.log(`exported components (${String(exported.length)}):\n  ${exported.join('\n  ') || '(none)'}`);
  console.log(`INTENT-FILTER CHECK: ${report.result}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(problems.length ? 1 : 0);
}
