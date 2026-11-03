#!/usr/bin/env node
/*
 * OpenAPI breaking-change gate (F-P3-09; ADR-027; CLAUDE.md §4). Compares the generated contract
 * packages/contracts/openapi/wayvro-api.v1.json of the working tree with the same file at the merged base and fails on
 * any oasdiff ERR-level (breaking) change. Additive evolution passes; a breaking change needs an approved compatibility
 * plan and a reviewed change to this gate, never a silent bypass.
 *
 * Base: `--base <git-ref>` if given; otherwise the merge base of HEAD and origin/main, or HEAD^1 when HEAD is already on
 * main (push to main). zod's JSON Schema output nests `$defs` inside each operation schema with `#/$defs/<id>` refs,
 * which oasdiff resolves against the document root; both specs are therefore normalised first by hoisting every `$defs`
 * entry into components.schemas (identical definitions share one name, differing ones get a suffix) — a lossless
 * re-arrangement of the same schemas.
 *
 * Usage: node scripts/openapi-breaking.mjs --oasdiff <binary> [--base <git-ref>]
 *        node scripts/openapi-breaking.mjs --oasdiff <binary> --self-test   (negative/positive controls)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'packages/contracts/openapi/wayvro-api.v1.json';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i] ?? '';
  if (a === '--self-test') args.selfTest = true;
  else args[a.replace(/^--/, '')] = argv[(i += 1)];
}
if (!args.oasdiff) {
  console.error('usage: --oasdiff <binary> [--base <git-ref>] [--self-test]');
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** Deterministic JSON (object keys sorted at every level). */
const stable = (v) =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v !== null && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const digest = (v) => createHash('sha256').update(stable(v)).digest('hex').slice(0, 10);

/**
 * Hoists every nested `$defs` block into components.schemas and rewrites its `#/$defs/<id>` refs. A definition keeps its
 * zod id as component name unless a DIFFERENT definition already uses it (e.g. input vs output variants), in which case
 * it gets a content-hash suffix; names are computed bottom-up from fully resolved content, so they are deterministic.
 */
export function normalise(spec) {
  const out = structuredClone(spec);
  out.components = out.components ?? {};
  const declared = out.components.schemas ?? {};
  const registry = {};
  const rewrite = (node, resolve) => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, resolve));
    if (node === null || typeof node !== 'object') return node;
    const copy = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/')) copy[k] = `#/components/schemas/${resolve(v.slice('#/$defs/'.length))}`;
      else copy[k] = rewrite(v, resolve);
    }
    return copy;
  };
  const visit = (node) => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    let current = node;
    if (current.$defs && typeof current.$defs === 'object') {
      const { $defs, ...rest } = current;
      const blockId = digest($defs);
      const names = new Map();
      const inProgress = new Set();
      const nameOf = (id) => {
        if (!(id in $defs)) throw new Error(`unresolved local ref #/$defs/${id}`);
        const known = names.get(id);
        if (known) return known;
        // a reference cycle: name every member after the whole block so the result stays deterministic
        if (inProgress.has(id)) {
          const cyclic = `${id}__c${blockId}`;
          names.set(id, cyclic);
          return cyclic;
        }
        inProgress.add(id);
        const content = visit(rewrite($defs[id], nameOf));
        inProgress.delete(id);
        let name = names.get(id);
        if (!name) {
          name = id in registry && stable(registry[id]) !== stable(content) ? `${id}__${digest(content)}` : id;
          names.set(id, name);
        }
        registry[name] = content;
        return name;
      };
      for (const id of Object.keys($defs)) nameOf(id);
      current = rewrite(rest, nameOf);
    }
    const result = {};
    for (const [k, v] of Object.entries(current)) result[k] = visit(v);
    return result;
  };
  out.paths = visit(out.paths);
  for (const [name, schema] of Object.entries(declared)) {
    const v = visit(schema);
    // a declared component that is only a wrapper around its own hoisted definition adds nothing
    if (v.$ref === `#/components/schemas/${name}` && Object.keys(v).every((k) => k === '$ref' || k === '$schema')) continue;
    registry[name] = v;
  }
  out.components.schemas = registry;
  return out;
}

function oasdiff(base, head) {
  const dir = mkdtempSync(join(tmpdir(), 'wayvro-oasdiff-'));
  const b = join(dir, 'base.json');
  const h = join(dir, 'head.json');
  writeFileSync(b, JSON.stringify(normalise(base)));
  writeFileSync(h, JSON.stringify(normalise(head)));
  const r = spawnSync(args.oasdiff, ['breaking', b, h, '--fail-on', 'ERR', '--format', 'text'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // oasdiff: 0 = no ERR-level change, 1 = breaking change found, anything else = the comparison itself failed
  const verdict = r.status === 0 ? 'PASS' : r.status === 1 ? 'BREAKING' : 'ERROR';
  return { verdict, status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

const head = JSON.parse(readFileSync(join(ROOT, SPEC), 'utf8'));

if (args.selfTest) {
  const removedRoute = structuredClone(head);
  delete removedRoute.paths['/v1/account/state'];
  // a required response field removed from a shared schema is breaking for clients (control must exist, never skipped)
  const narrowed = normalise(head);
  const state = narrowed.components.schemas['AccountState'];
  const [firstRequired] = state?.required ?? [];
  if (!state?.properties || !firstRequired) throw new Error('self-test control schema AccountState with a required field not found');
  state.properties = Object.fromEntries(Object.entries(state.properties).filter(([k]) => k !== firstRequired));
  state.required = state.required.filter((x) => x !== firstRequired);
  // a value added to a CLOSED response enum is breaking (the x-extensible-enum list must not hide this)
  const widened = normalise(head);
  const accountStatus = widened.components.schemas['AccountState']?.properties?.account?.properties?.status;
  if (!Array.isArray(accountStatus?.enum)) throw new Error('self-test control enum AccountState.account.status not found');
  accountStatus.enum = [...accountStatus.enum, 'FROZEN'];
  const cases = [
    { name: 'identical spec', base: head, head, breaking: false },
    { name: 'value added to a closed response enum', base: head, head: widened, breaking: true },
    { name: 'route removed', base: head, head: removedRoute, breaking: true },
    { name: `response field ${firstRequired} removed`, base: head, head: narrowed, breaking: true },
  ];
  let failed = 0;
  for (const c of cases) {
    const r = oasdiff(c.base, c.head);
    const ok = r.verdict === (c.breaking ? 'BREAKING' : 'PASS');
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: oasdiff exit ${String(r.status)}${r.output ? ` — ${r.output.split('\n')[0]}` : ''}`);
  }
  console.log(`OPENAPI BREAKING-CHANGE GATE SELF-TEST: ${failed === 0 ? 'PASS' : 'FAIL'} (${String(cases.length)} cases)`);
  process.exit(failed === 0 ? 0 : 1);
}

let base = args.base;
if (!base) {
  const mergeBase = git('merge-base', 'HEAD', 'origin/main');
  base = mergeBase === git('rev-parse', 'HEAD') ? 'HEAD^1' : mergeBase;
}
let baseSpec;
try {
  baseSpec = JSON.parse(git('show', `${base}:${SPEC}`));
} catch (e) {
  console.error(`could not read ${SPEC} at ${base}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const r = oasdiff(baseSpec, head);
console.log(`base: ${git('rev-parse', '--short', base)} (${base})`);
console.log(r.output || 'no breaking changes');
console.log(`OPENAPI BREAKING-CHANGE CHECK: ${r.verdict === 'PASS' ? 'PASS' : `FAIL (${r.verdict})`}`);
process.exit(r.verdict === 'PASS' ? 0 : 1);
