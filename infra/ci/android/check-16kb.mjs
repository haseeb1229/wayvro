#!/usr/bin/env node
/*
 * Wayvro Android 16 KB page-size + ABI validator (Q49 / ADR-036). Node >= 18, no npm dependencies.
 *
 * Checks, on an Android App Bundle:
 *   1. ABI set: the exact set of lib/<abi>/ directories equals --expect-abis (Q49 evidence-based ABI set).
 *   2. ELF alignment: every PT_LOAD segment of every 64-bit native library has p_align >= 16384.
 *      32-bit libraries are reported (Play's 16 KB rule applies to 64-bit ABIs) but do not fail the check.
 *   3. APK zip alignment: bundletool build-apks generates the split APKs Play would serve; every uncompressed .so entry
 *      must start at a 16384-byte file offset (verified by this script) and, when zipalign is available,
 *      `zipalign -c -P 16 -v 4` must pass on each APK containing native code.
 *
 * Usage:
 *   node infra/ci/android/check-16kb.mjs --aab app-release.aab --bundletool bundletool-all.jar \
 *        --expect-abis arm64-v8a,armeabi-v7a [--zipalign <path>] [--report out.json]
 * Exit code 0 = PASS, 1 = FAIL, 2 = usage/tooling error.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip } from './lib/zip.mjs';

const PAGE_16K = 16384;
const SIXTY_FOUR_BIT_ABIS = new Set(['arm64-v8a', 'x86_64']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith('--') || v === undefined) throw new Error(`bad argument near ${k}`);
    out[k.slice(2)] = v;
  }
  return out;
}

/** Returns the PT_LOAD alignments of an ELF shared object. */
function elfLoadAlignments(elf) {
  if (elf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const is64 = elf[4] === 2;
  const le = elf[5] === 1;
  const u16 = (o) => (le ? elf.readUInt16LE(o) : elf.readUInt16BE(o));
  const u32 = (o) => (le ? elf.readUInt32LE(o) : elf.readUInt32BE(o));
  const u64 = (o) => Number(le ? elf.readBigUInt64LE(o) : elf.readBigUInt64BE(o));
  const phoff = is64 ? u64(0x20) : u32(0x1c);
  const phentsize = is64 ? u16(0x36) : u16(0x2a);
  const phnum = is64 ? u16(0x38) : u16(0x2c);
  const aligns = [];
  for (let i = 0; i < phnum; i++) {
    const h = phoff + i * phentsize;
    if (u32(h) !== 1) continue; // PT_LOAD
    aligns.push(is64 ? u64(h + 0x30) : u32(h + 0x1c));
  }
  return { is64, aligns };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.aab || !args.bundletool || !args['expect-abis']) {
    console.error('usage: --aab <file> --bundletool <jar> --expect-abis a,b [--zipalign <path>] [--report <json>]');
    process.exit(2);
  }
  const problems = [];
  const report = { aab: args.aab, expectedAbis: args['expect-abis'].split(',').sort(), abis: [], libraries: [], apks: [], zipalign: [] };

  // 1 + 2: ABI set and ELF alignment inside the bundle.
  const bundle = readZip(readFileSync(args.aab));
  const abiSet = new Set();
  for (const e of bundle) {
    const m = /^[^/]+\/lib\/([^/]+)\/([^/]+\.so)$/.exec(e.name);
    if (!m) continue;
    const [, abi, lib] = m;
    abiSet.add(abi);
    const { is64, aligns } = elfLoadAlignments(e.read());
    const minAlign = Math.min(...aligns);
    const ok16k = aligns.every((a) => a >= PAGE_16K);
    report.libraries.push({ abi, lib, elf64: is64, loadAlignments: aligns, ok16k });
    if (SIXTY_FOUR_BIT_ABIS.has(abi) && !ok16k) problems.push(`${abi}/${lib}: PT_LOAD alignment ${minAlign} < 16384`);
  }
  report.abis = [...abiSet].sort();
  if (report.abis.join(',') !== report.expectedAbis.join(',')) {
    problems.push(`ABI set ${report.abis.join(',') || '(none)'} != expected ${report.expectedAbis.join(',')}`);
  }
  if (report.libraries.length === 0) problems.push('no native libraries found in bundle (unexpected for React Native)');

  // 3: APK zip alignment of the split APKs bundletool produces.
  const work = mkdtempSync(join(tmpdir(), 'wayvro-16kb-'));
  try {
    const apksPath = join(work, 'out.apks');
    execFileSync('java', ['-jar', args.bundletool, 'build-apks', `--bundle=${args.aab}`, `--output=${apksPath}`, '--overwrite'], { stdio: 'pipe' });
    for (const apkEntry of readZip(readFileSync(apksPath)).filter((e) => e.name.endsWith('.apk'))) {
      const apkBuf = apkEntry.read();
      const libs = readZip(apkBuf).filter((e) => /^lib\/[^/]+\/[^/]+\.so$/.test(e.name));
      if (libs.length === 0) continue;
      const misaligned = libs.filter((e) => e.method === 0 && e.dataOffset % PAGE_16K !== 0).map((e) => e.name);
      const compressed = libs.filter((e) => e.method !== 0).map((e) => e.name);
      report.apks.push({ apk: apkEntry.name, nativeLibs: libs.length, storedUncompressed: libs.length - compressed.length, misaligned, compressed });
      if (misaligned.length) problems.push(`${apkEntry.name}: ${misaligned.length} uncompressed .so not 16 KB aligned`);
      if (args.zipalign) {
        const apkFile = join(work, apkEntry.name.replace(/[/\\]/g, '_'));
        writeFileSync(apkFile, apkBuf);
        try {
          execFileSync(args.zipalign, ['-c', '-P', '16', '-v', '4', apkFile], { stdio: 'pipe' });
          report.zipalign.push({ apk: apkEntry.name, result: 'PASS' });
        } catch (e) {
          const out = `${e.stdout ?? ''}`
            .split('\n')
            .filter((l) => /BAD|fail/i.test(l))
            .slice(0, 5);
          report.zipalign.push({ apk: apkEntry.name, result: 'FAIL', detail: out });
          problems.push(`zipalign -P 16 failed for ${apkEntry.name}`);
        }
      }
    }
    if (report.apks.length === 0) problems.push('bundletool produced no APK containing native libraries');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  report.result = problems.length ? 'FAIL' : 'PASS';
  report.problems = problems;
  if (args.report) writeFileSync(args.report, JSON.stringify(report, null, 2) + '\n');
  const libs64 = report.libraries.filter((l) => SIXTY_FOUR_BIT_ABIS.has(l.abi));
  console.log(`ABIs: ${report.abis.join(', ')} (expected ${report.expectedAbis.join(', ')})`);
  console.log(`64-bit libraries 16 KB aligned: ${libs64.filter((l) => l.ok16k).length}/${libs64.length}`);
  console.log(
    `32-bit libraries 16 KB aligned (informational): ${report.libraries.filter((l) => !l.elf64 && l.ok16k).length}/${report.libraries.filter((l) => !l.elf64).length}`,
  );
  console.log(
    `split APKs with native code: ${report.apks.length}; zipalign -P 16: ${report.zipalign.map((z) => z.result).join(', ') || 'NOT RUN (no --zipalign)'}`,
  );
  console.log(`16 KB CHECK: ${report.result}`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(problems.length ? 1 : 0);
}

main();
