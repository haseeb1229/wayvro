#!/usr/bin/env node
/*
 * SP-08 Maestro runner (ADR-052; docs/phase3/PHASE3_SP08_CROSS_MODE_E2E.md §5–§8). Runs one tier of the cross-mode
 * matrix against the stack written by tests/e2e-mobile/mobile-stack.mjs on ONE Android emulator, applies the flake
 * policy and writes the evidence:
 *
 *   node tests/e2e-mobile/run-flows.mjs --tier pr|full [--device emulator-5554] [--apk <e2e apk>] [--maestro <bin>]
 *        [--out build-logs/e2e-mobile/<tier>] [--budget-seconds 900] [--api-level 35] [--lane <label>] [--only id,id]
 *        [--shard i/n]   (PR tier only: run the flows of shard i of the n balanced shards in flows/manifest.mjs)
 *
 * Flake policy (§6): at most ONE automatic retry per flow; a pass on retry is FLAKY (never PASS); INV-07 flows (#1,
 * #12) are never quarantined and a FLAKY INV-07 flow fails the run; a flow that cannot run is BLOCKED with its cause;
 * flows whose prerequisite is missing are NOT RUN with the reason (e.g. no ACTIVE synthetic rate card) — never silently skipped.
 * A lost emulator adb transport ("device offline", Maestro's device server dying) is an INFRASTRUCTURE failure: the
 * attempt is BLOCKED with that cause (a pass on the retry is still FLAKY), never PASS.
 * The runner exits 1 on any FAIL / BLOCKED / FLAKY INV-07 result or when the Maestro phase exceeds its budget.
 * Waits are Maestro's element waits; the runner itself never sleeps to "settle" the UI.
 *
 * Evidence: <out>/summary.json + summary.md (per-flow status, attempts, seconds), Maestro JUnit per invocation,
 * screenshots (takeScreenshot + Maestro step captures) under <out>/<flow>/, a screen recording of the retry of every
 * failed flow (video for failed flows only), logcat of the app-relevant tags. EMULATOR evidence only — never device
 * evidence (CLAUDE.md §8).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOWS, PR_SHARDS, validatePrShards } from './flows/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLOW_DIR = join(ROOT, 'tests', 'e2e-mobile', 'flows');
const APP_ID = 'dev.wayvro.app';
const WINDOWS = process.platform === 'win32';
const say = (line) => process.stdout.write(`run-flows: ${line}\n`);

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '') ?? ''] = argv[i + 1];
const tier = args.tier;
if (tier !== 'pr' && tier !== 'full') {
  process.stderr.write('usage: --tier pr|full [--device <serial>] [--apk <apk>] [--maestro <bin>] [--out <dir>] [--budget-seconds N]\n');
  process.exit(2);
}
const apiLevel = Number(args['api-level'] ?? '35');
const lane = args.lane ?? `api-${String(apiLevel)}`;
const budgetSeconds = Number(args['budget-seconds'] ?? (tier === 'pr' ? '900' : '3600'));
const out = args.out ?? join(ROOT, 'build-logs', 'e2e-mobile', `${tier}-${lane}`);
const shardArg = args.shard ? /^(\d+)\/(\d+)$/.exec(args.shard) : null;
if (args.shard && (!shardArg || tier !== 'pr')) {
  process.stderr.write('--shard i/n is only valid with --tier pr\n');
  process.exit(2);
}
if (shardArg) {
  const problems = validatePrShards(Number(shardArg[2]));
  if (problems.length > 0 || !PR_SHARDS[Number(shardArg[1])]) {
    process.stderr.write(`invalid PR shard assignment: ${problems.join('; ') || `no shard ${shardArg[1]}`}\n`);
    process.exit(2);
  }
}
const only = shardArg ? new Set(PR_SHARDS[Number(shardArg[1])]) : args.only ? new Set(args.only.split(',')) : null;
const maestroBin = args.maestro ?? process.env.MAESTRO_BIN ?? 'maestro';
const adbBin = join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? '', 'platform-tools', WINDOWS ? 'adb.exe' : 'adb');

const stack = JSON.parse(readFileSync(join(ROOT, 'build-logs', 'e2e-mobile', 'stack.json'), 'utf8'));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const adbRaw = (list, opts = {}) => spawnSync(adbBin, list, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const device =
  args.device ??
  adbRaw(['devices'])
    .stdout.split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find((p) => p[1] === 'device')?.[0];
if (!device) {
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ tier, lane, result: 'BLOCKED', reason: 'no booted Android device/emulator' }, null, 2));
  say('BLOCKED: no booted Android device/emulator');
  process.exit(1);
}
const adb = (list) => {
  const r = adbRaw(['-s', device, ...list]);
  if (r.status !== 0) throw new Error(`adb ${list.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
};

// ── device preparation ──────────────────────────────────────────────────────────────────────────────────────────
for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb(['shell', 'settings', 'put', 'global', k, '0']);
if (args.apk) {
  adbRaw(['-s', device, 'uninstall', APP_ID]);
  // Plain install (no -g): runtime permissions stay at the OS default (never pre-granted).
  adb(['install', args.apk]);
}

// ── hooks and checks (server state through the seed connection; device state through adb) ────────────────────────
const pg = createRequire(join(ROOT, 'packages/db/package.json'))('pg');
async function sql(text, values) {
  const client = new pg.Client({ connectionString: stack.databaseUrl });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}
const hooks = {
  /** #21 HARD: an ACTIVE Android version policy whose minimum supported build (2) is above the E2E build (1). */
  async activateHardUpdatePolicy() {
    const version = (await sql(`select coalesce(max(version), 0) + 1 as v from platform.app_version_policies where platform = 'ANDROID'`)).rows[0].v;
    await sql(
      `insert into platform.app_version_policies (id, platform, version, status, min_supported_build, recommended_build, soft_message_key, hard_message_key,
                                                 effective_from, drafted_by_staff_id, approved_by_staff_id)
       values (gen_random_uuid(), 'ANDROID', $1, 'ACTIVE', 2, 2, 'app.softUpdate.body', 'app.update.reason.MINIMUM_BUILD', now(), $2, $3)`,
      [version, stack.staffIds[0], stack.staffIds[1]],
    );
  },
  async retireUpdatePolicies() {
    await sql(`update platform.app_version_policies set status = 'RETIRED', effective_until = now(), version_lock = version_lock + 1 where status = 'ACTIVE'`);
  },
  /** #22: the RIDER-scoped `rider.quotes` switch in its safe (DISABLED) state; restored to ENABLED afterwards. */
  async disableRiderQuotes() {
    await sql(
      `insert into platform.runtime_switches (id, key, scope, city_code, state, reason_code, changed_by_staff_id)
       values (gen_random_uuid(), 'rider.quotes', 'RIDER', null, 'DISABLED', 'E2E_SWITCH_TEST', $1)
       on conflict on constraint runtime_switches_target do update set state = 'DISABLED', reason_code = 'E2E_SWITCH_TEST', version = platform.runtime_switches.version + 1, updated_at = now()`,
      [stack.staffIds[0]],
    );
  },
  async enableRiderQuotes() {
    await sql(
      `update platform.runtime_switches set state = 'ENABLED', approved_by_staff_id = $1, version = version + 1, updated_at = now() where key = 'rider.quotes'`,
      [stack.staffIds[1]],
    );
  },
  /** #26 / A11Y-01: 200 % font scale for the capture pass, reset afterwards. */
  fontScale200() {
    adb(['shell', 'settings', 'put', 'system', 'font_scale', '2.0']);
  },
  fontScaleReset() {
    adb(['shell', 'settings', 'put', 'system', 'font_scale', '1.0']);
  },
  /** #11: revoke location while the app is in the background (pm revoke kills the process as Android does). */
  revokeLocation() {
    adb(['shell', 'pm', 'revoke', APP_ID, 'android.permission.ACCESS_FINE_LOCATION']);
    adb(['shell', 'pm', 'revoke', APP_ID, 'android.permission.ACCESS_COARSE_LOCATION']);
  },
};

/** #12 RIDER-HYGIENE: runtime permissions and camera app-op after a rider-only journey. Returns problems. */
function riderHygiene(opts) {
  const problems = [];
  // adb on Windows returns CRLF line endings; normalise before parsing.
  const dump = adb(['shell', 'dumpsys', 'package', APP_ID]).replaceAll('\r\n', '\n');
  const runtime = new Map();
  for (const m of dump.matchAll(/^\s+(android\.permission\.[A-Z_]+): granted=(true|false), flags=\[([^\]]*)\]/gm))
    runtime.set(m[1], { granted: m[2] === 'true', flags: m[3] });
  const requested = new Set(
    [...(/requested permissions:\n((?:\s+android\.permission\.[A-Z_]+.*\n)+)/.exec(dump)?.[1] ?? '').matchAll(/android\.permission\.[A-Z_]+/g)].map(
      (m) => m[0],
    ),
  );
  for (const p of [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.FOREGROUND_SERVICE_LOCATION',
    'android.permission.USE_FULL_SCREEN_INTENT',
  ])
    if (requested.has(p)) problems.push(`${p} is declared`);
  // Positive control: the parse must see the app's declared INTERNET permission, otherwise the checks above are vacuous.
  if (!requested.has('android.permission.INTERNET')) problems.push('could not parse the requested-permissions list of dumpsys package');
  if (runtime.size === 0) problems.push('could not parse any runtime permission state from dumpsys package');
  for (const [name, state] of runtime) {
    const locationTapped = opts.locationAllowed && /LOCATION/.test(name);
    if (state.granted && !locationTapped) problems.push(`${name} granted`);
    if (/USER_SET|USER_FIXED/.test(state.flags) && !(opts.locationAsked && /LOCATION/.test(name))) problems.push(`${name} was asked (${state.flags.trim()})`);
  }
  const camera = adbRaw(['-s', device, 'shell', 'appops', 'get', APP_ID, 'CAMERA']).stdout;
  if (/time=|duration=|Access:/i.test(camera)) problems.push(`CAMERA app-op shows access: ${camera.trim()}`);
  return { problems, evidence: { runtime: Object.fromEntries(runtime), requested: [...requested], cameraAppOp: camera.trim() } };
}
const checks = { riderHygiene };

// ── Maestro ──────────────────────────────────────────────────────────────────────────────────────────────────────
const flowEnv = ['-e', `API=${stack.apiBaseUrl}`];
for (const [key, a] of Object.entries(stack.accounts)) flowEnv.push('-e', `PHONE_${key}=${a.phone}`, '-e', `PHONE_LOCAL_${key}=${a.localPhone}`);
const maestroEnv = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', MAESTRO_DISABLE_UPDATE_CHECK: 'true' };

function runMaestro(files, dir) {
  mkdirSync(dir, { recursive: true });
  const junit = join(dir, 'junit.xml');
  const list = [
    '--device',
    device,
    'test',
    '--format',
    'JUNIT',
    '--output',
    junit,
    '--test-output-dir',
    dir,
    ...flowEnv,
    ...files.map((f) => join(FLOW_DIR, f)),
  ];
  const r = WINDOWS
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', maestroBin, ...list], { env: maestroEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    : spawnSync(maestroBin, list, { env: maestroEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(join(dir, 'maestro-console.txt'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  const results = new Map();
  const reasons = new Map();
  for (const m of `${r.stdout ?? ''}`.matchAll(/\[Failed\] (\S+) \([^)]*\) \((.+)\)\s*$/gm)) reasons.set(m[1], m[2]);
  if (existsSync(junit)) {
    for (const m of readFileSync(junit, 'utf8').matchAll(/<testcase\b[^>]*\bname="([^"]+)"[^>]*\bstatus="([A-Z_]+)"/g)) results.set(m[1], m[2] === 'SUCCESS');
  }
  return { results, reasons, spawnError: r.error ? String(r.error) : null };
}

/** Records the screen while `fn` runs (video for the retry of a failed flow). */
function recording(dir, name) {
  const remote = `/sdcard/wayvro-e2e-${name}.mp4`;
  const proc = spawn(adbBin, ['-s', device, 'shell', 'screenrecord', '--time-limit', '180', remote], { stdio: 'ignore' });
  return () => {
    proc.kill('SIGINT');
    adbRaw(['-s', device, 'shell', 'pkill', '-INT', 'screenrecord']);
    adbRaw(['-s', device, 'pull', remote, join(dir, `${name}-retry.mp4`)]);
    adbRaw(['-s', device, 'shell', 'rm', '-f', remote]);
  };
}

const dismissSystemDialogs = () => adbRaw(['-s', device, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS']);
/** Maestro's own log shows the emulator's adb transport going away (infrastructure, not an app failure). */
function infraLost(flowDir) {
  const logs = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'maestro.log' || e.name === 'maestro-console.txt') logs.push(p);
    }
  };
  walk(dirname(flowDir));
  return logs.some((p) => /device offline|DeviceServerDiedException/.test(readFileSync(p, 'utf8')));
}

/** The adb transport of a loaded emulator can drop for a moment; wait (bounded) until it is back and booted. */
function deviceReady() {
  adbRaw(['-s', device, 'wait-for-device'], { timeout: 120_000 });
  return adbRaw(['-s', device, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 30_000 }).stdout?.trim() === '1';
}

async function attempt(flow, dir) {
  const steps = flow.sequence ?? [{ maestro: flow.file }];
  const problems = [];
  try {
    for (const h of flow.before ?? []) await hooks[h]();
    for (const step of steps) {
      if (step.hook) {
        await hooks[step.hook]();
        continue;
      }
      if (!deviceReady()) return { ok: false, blocked: `device ${device} not reachable/booted (adb transport lost)` };
      dismissSystemDialogs();
      const { results, reasons, spawnError } = runMaestro([step.maestro], join(dir, step.maestro.replace(/\.yaml$/, '')));
      const name = step.maestro.replace(/\.yaml$/, '');
      if (spawnError) return { ok: false, blocked: `maestro could not start: ${spawnError}` };
      if (!results.has(name)) return { ok: false, blocked: `maestro produced no result for ${name} (see maestro-console.txt)` };
      if (!results.get(name) && infraLost(join(dir, name)))
        return { ok: false, blocked: `emulator adb transport lost during ${name} (device offline; infrastructure)` };
      if (!results.get(name)) problems.push(`${name} failed: ${reasons.get(name) ?? 'see maestro-console.txt'}`);
      if (problems.length) break;
    }
    if (problems.length === 0)
      for (const c of flow.checks ?? []) {
        const r = checks[c.name](c);
        writeFileSync(join(dir, `${c.name}.json`), JSON.stringify(r, null, 2));
        problems.push(...r.problems.map((p) => `${c.name}: ${p}`));
      }
  } finally {
    for (const h of flow.after ?? []) await hooks[h]();
  }
  return { ok: problems.length === 0, problems };
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const quarantine = JSON.parse(readFileSync(join(FLOW_DIR, 'quarantine.json'), 'utf8')).entries;
const selected = FLOWS.filter((f) => f.tiers.includes(tier) && (only === null || only.has(f.id)));
const started = Date.now();
const rows = [];
adbRaw(['-s', device, 'logcat', '-c']);
for (const flow of selected) {
  const row = { id: flow.id, sp08: flow.sp08, accounts: flow.accounts, inv07: flow.inv07 === true, attempts: 0, seconds: 0 };
  rows.push(row);
  if (flow.notTestable) Object.assign(row, { status: 'NOT TESTABLE', reason: flow.notTestable });
  else if (flow.manualOnly) Object.assign(row, { status: 'NOT RUN', reason: flow.manualOnly });
  else if (flow.requires?.includes('pricing') && !stack.pricing.seeded)
    Object.assign(row, { status: 'NOT RUN', reason: `pricing not seeded: ${stack.pricing.reason}` });
  else if (flow.apiLevels && !flow.apiLevels.includes(apiLevel))
    Object.assign(row, { status: 'SKIPPED', reason: `runs on API ${flow.apiLevels.join('/')} only (system-dialog taps, SP-08 §6)` });
  else if ((Date.now() - started) / 1000 > budgetSeconds)
    Object.assign(row, { status: 'BLOCKED', reason: `Maestro phase budget of ${String(budgetSeconds)} s exhausted before this flow` });
  if (row.status) {
    say(`${flow.id}: ${row.status} (${row.reason})`);
    continue;
  }
  const dir = join(out, flow.id);
  const t0 = Date.now();
  row.attempts = 1;
  let result = await attempt(flow, join(dir, 'attempt-1'));
  if (!result.ok) {
    row.attempts = 2;
    row.firstAttempt = result.problems ?? [result.blocked];
    const stop = recording(dir, flow.id);
    try {
      result = await attempt(flow, join(dir, 'attempt-2'));
    } finally {
      stop();
    }
    row.status = result.ok ? 'FLAKY' : result.blocked ? 'BLOCKED' : 'FAIL';
  } else row.status = 'PASS';
  if (result.blocked) row.reason = result.blocked;
  if (!result.ok && result.problems?.length) row.problems = result.problems;
  row.quarantined = !row.inv07 && quarantine.some((q) => q.id === flow.id && Date.parse(q.expires) > Date.now());
  row.seconds = Math.round((Date.now() - t0) / 1000);
  say(`${flow.id}: ${row.status} in ${String(row.seconds)} s${row.problems ? ` — ${row.problems.join('; ')}` : ''}`);
}
const maestroSeconds = Math.round((Date.now() - started) / 1000);
writeFileSync(
  join(out, 'logcat.txt'),
  adbRaw(['-s', device, 'logcat', '-d', '-v', 'time', '-s', 'ReactNativeJS:V', 'ActivityTaskManager:I', 'AndroidRuntime:E']).stdout ?? '',
);

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
const failing = rows.filter((r) => (r.status === 'FAIL' && !r.quarantined) || r.status === 'BLOCKED' || (r.status === 'FLAKY' && r.inv07));
const overBudget = maestroSeconds > budgetSeconds;
const summary = {
  tier,
  lane,
  shard: shardArg ? { index: Number(shardArg[1]), of: Number(shardArg[2]), flows: [...only] } : null,
  evidenceClass: 'EMULATOR (not device evidence)',
  device,
  apiLevel,
  apk: args.apk ?? '(pre-installed)',
  pricing: stack.pricing,
  maestroPhaseSeconds: maestroSeconds,
  budgetSeconds,
  overBudget,
  counts,
  result: failing.length || overBudget ? 'FAIL' : 'PASS',
  flows: rows,
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const md = [
  `# SP-08 ${tier.toUpperCase()} tier — ${lane} (EMULATOR evidence only)`,
  '',
  `Result: **${summary.result}** · Maestro phase ${String(maestroSeconds)} s (budget ${String(budgetSeconds)} s) · ${Object.entries(counts)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(' · ')}`,
  '',
  '| Flow | SP-08 | Accounts | Status | Attempts | Seconds | Notes |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.sp08} | ${r.accounts.join(', ')} | ${r.status}${r.quarantined ? ' (quarantined)' : ''} | ${String(r.attempts)} | ${String(r.seconds)} | ${(r.reason ?? r.problems?.join('; ') ?? (r.firstAttempt ? `attempt 1: ${r.firstAttempt.join('; ')}` : '')).replaceAll('|', '/')} |`,
  ),
  '',
].join('\n');
writeFileSync(join(out, 'summary.md'), md);
say(`${summary.result}: ${JSON.stringify(counts)} in ${String(maestroSeconds)} s → ${join(out, 'summary.md')}`);
process.exit(summary.result === 'PASS' ? 0 : 1);
