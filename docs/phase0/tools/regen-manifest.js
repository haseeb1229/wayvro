#!/usr/bin/env node
/*
 * Regenerates V5_FILE_MANIFEST.json (SHA-256 of every file of the documentation/planning package, excluding itself) and
 * V5_VALIDATION_SUMMARY.json (package consistency checks). Node >= 18, no dependencies.
 * Usage: node docs/phase0/tools/regen-manifest.js [--check]   (--check: exit 1 if manifest is stale or checks fail)
 *
 * Scope (Phase 1, 2026-10-09): the manifest covers the planning package — the root governance files listed in
 * PACKAGE_ROOT_FILES plus everything under docs/ and prompts/. Source code, lockfiles and machine-specific build output
 * (android/, dist/, .next/, .turbo/ …) are integrity-protected by Git and CI instead; hashing them made the manifest
 * unreproducible and forced a regeneration on every code commit. The prohibited separate-app path check still scans the
 * WHOLE repository (see `repoFiles`).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST = path.join(ROOT, 'V5_FILE_MANIFEST.json');
const SUMMARY = path.join(ROOT, 'V5_VALIDATION_SUMMARY.json');
const CHECK = process.argv.includes('--check');
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.claude']);
const PACKAGE_ROOT_FILES = ['.gitattributes', 'ALL_FILES_INDEX.md', 'CLAUDE.md', 'README.md', 'V5_VALIDATION_SUMMARY.json'];
const PACKAGE_DIRS = ['docs', 'prompts'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function packageFiles() {
  const out = PACKAGE_ROOT_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const d of PACKAGE_DIRS) out.push(...walk(path.join(ROOT, d), []).map(rel));
  return out.sort();
}

const files = packageFiles();
const repoFiles = walk(ROOT, []).map(rel);
const manifest = {
  package: 'Wayvro Claude-only Blueprint v5 + Phase 0 (2026-10-09)',
  generated_on: '2026-10-09',
  generator: 'docs/phase0/tools/regen-manifest.js',
  manifest_excludes_self: true,
  scope: { root_files: PACKAGE_ROOT_FILES, directories: PACKAGE_DIRS, note: 'documentation/planning package only; code and build output are protected by Git + CI' },
  file_count_excluding_manifest: files.length,
  files: files.map((p) => { const b = fs.readFileSync(path.join(ROOT, p)); return { path: p, bytes: b.length, sha256: sha(b) }; }),
};

// Consistency checks
const problems = [];
const register = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/requirements-register.json'), 'utf8'));
const items = register.items;
const ids = items.map((i) => i.id);
if (new Set(ids).size !== ids.length) problems.push('duplicate register IDs');
const prio = {}; items.forEach((i) => (prio[i.priority] = (prio[i.priority] || 0) + 1));
const inv = fs.readFileSync(path.join(ROOT, 'docs/03_FEATURE_INVENTORY.md'), 'utf8');
const invRows = [...inv.matchAll(/^- ([A-Z]\d{2}) (P[0-3]) (.*)$/gm)];
const invMap = new Map(invRows.map((m) => [m[1], { p: m[2], t: m[3].replace(/\.\s*$/, '').trim() }]));
let invMismatch = 0;
for (const i of items) { const v = invMap.get(i.id); if (!v || v.p !== i.priority || v.t !== i.title.replace(/\.\s*$/, '').trim()) invMismatch++; }
if (invRows.length !== items.length) problems.push(`inventory rows ${invRows.length} != register ${items.length}`);
if (invMismatch) problems.push(`${invMismatch} inventory/register mismatches`);
const notStamped = items.filter((i) => !i.phase0).length; if (notStamped) problems.push(`${notStamped} items without phase0 block`);
const coverage = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json'), 'utf8'));
if (coverage.items.length !== items.length) problems.push('coverage count != register count');
const risks = fs.readFileSync(path.join(ROOT, 'docs/15_RISKS_AND_FAILURE_MODES.md'), 'utf8');
const riskIds = [...risks.matchAll(/^\| (RSK-\d{3}) \|/gm)].map((m) => m[1]);
if (new Set(riskIds).size !== riskIds.length) problems.push('duplicate risk IDs');
const phases = fs.readFileSync(path.join(ROOT, 'docs/12_PHASE_PLAN_AND_GATES.md'), 'utf8');
const phaseNums = [...phases.matchAll(/^## Phase (\d+) /gm)].map((m) => +m[1]);
if (phaseNums.join(',') !== '0,1,2,3,4,5,6,7,8,9,10,11,12') problems.push('phase headings not exactly 0..12');
// Backticked local file references must exist (markdown files only), ignoring glob-like or placeholder refs.
const missingRefs = [];
for (const p of files.filter((f) => f.endsWith('.md') && !f.endsWith('PHASE0_PHASE1_PROMPT_PROPOSED.md'))) { // Phase 1 prompt names files Phase 1 will create
  const txt = fs.readFileSync(path.join(ROOT, p), 'utf8');
  for (const m of txt.matchAll(/`((?:docs|prompts|apps|packages|infra|tests)\/[A-Za-z0-9_./-]+\.(?:md|json|csv|js))`/g)) {
    const ref = m[1];
    if (/[*<>{}]/.test(ref)) continue;
    if (!fs.existsSync(path.join(ROOT, ref))) missingRefs.push(`${p} -> ${ref}`);
  }
}
if (missingRefs.length) problems.push('missing file references: ' + missingRefs.join('; '));
const stale511 = [];
for (const p of ['README.md', 'ALL_FILES_INDEX.md', 'docs/00_README_AND_STATUS.md', 'docs/17_QUICK_START.md', 'prompts/PHASE_0_DISCOVERY_CLAUDE.md']) {
  const t = fs.readFileSync(path.join(ROOT, p), 'utf8');
  if (/\b511\b(?![^.\n]*(?:v5|original|Phase 0|baseline|\+ 20))/.test(t)) stale511.push(p);
}
if (stale511.length) problems.push('unqualified 511 count in: ' + stale511.join(', '));
const prohibited = repoFiles.filter((f) => /apps\/(wayvro-)?(rider|driver)[-_]?app/i.test(f));
if (prohibited.length) problems.push('prohibited separate-app paths: ' + prohibited.join(', '));

// Founder-review closure checks (2026-10-09). "Active" docs exclude preserved research evidence and historical audits;
// research files keep original wording but must carry closure annotations.
const activeDocs = files.filter((f) => (f.endsWith('.md') || f.endsWith('.js') || f === 'docs/requirements-register.json')
  && !f.startsWith('docs/phase0/research/') && !/docs\/(20|24)_/.test(f) && f !== 'docs/phase0/tools/regen-manifest.js');
const banned = [
  ['stale "currently 511" count', /currently 511/i],
  ['old Q49 arm64-only wording', /arm64 Android App Bundle|ship arm64-only/i],
  ['full-screen intent required for offers', /full-screen intent permission handling/i],
  ['gender verified/inferred from CNIC document', /document-verified gender|reviewer-verified from the CNIC|CNIC-document-verified|document-based gender verification/i],
  ['Pvt Ltd mandated for sole founder', /Incorporate Pvt Ltd|\*\*Pvt Ltd\*\* \(investor-ready|Pvt Ltd recommended over SMC/i],
  ['unreviewed cash-in-transit accounting asset', /cash-in-transit/i],
  ['incumbent licence status stated as fact', /Yango first licensee|first issued to Yango|Yango Ride received the first/i],
  ['hard-coded NDK r28', /NDK r28\+? (default|and run)/i],
];
const closureHits = [];
for (const f of activeDocs) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [label, re] of banned) if (re.test(txt)) closureHits.push(`${label}: ${f}`);
}
const reg = Object.fromEntries(items.map((i) => [i.id, i]));
const p1 = fs.readFileSync(path.join(ROOT, 'docs/phase0/PHASE0_PHASE1_PROMPT_PROPOSED.md'), 'utf8');
const researchFiles = files.filter((f) => f.startsWith('docs/phase0/research/R') && /R(2|4|6)_/.test(f));
const closureChecks = {
  q49_has_app_store_production: /App Store Connect production/.test(reg.Q49.title),
  q49_not_arm64_only_by_default: /arm64-only only after explicit device\/market evidence/.test(reg.Q49.title),
  m26_no_fsi_dependency: /not requested by default/.test(reg.M26.title) && /never authoritative/.test(reg.M26.title),
  phase9_capabilities_moved: ['B15', 'B16', 'B17', 'B18', 'B19', 'E13', 'E14', 'E17', 'L03', 'L24'].every((id) => reg[id].phase0.target_phase === 9),
  priorities_unchanged_for_moved_ids: reg.B15.priority === 'P1' && reg.E17.priority === 'P2',
  phase1_prompt_early_spikes: /SP-03/.test(p1) && /SP-05/.test(p1) && /JDK 17/.test(p1) && /SP-AND/.test(p1),
  phase0_prompt_marked_executed: /STATUS: EXECUTED on 2026-10-09/.test(fs.readFileSync(path.join(ROOT, 'prompts/PHASE_0_DISCOVERY_CLAUDE.md'), 'utf8')),
  one_public_app_v01_present: /one public mobile application/i.test(reg.V01.title),
  research_files_carry_closure_annotations: researchFiles.every((f) => /Closure note/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))),
  banned_wording_hits: closureHits,
};
for (const [k, v] of Object.entries(closureChecks)) {
  if (k === 'banned_wording_hits') { if (v.length) problems.push('closure wording violations: ' + v.join('; ')); }
  else if (v !== true) problems.push('closure check failed: ' + k);
}

const summary = {
  package: 'Wayvro Claude-only Blueprint v5 + Phase 0 dispositioned baseline',
  generated_on: '2026-10-09',
  generator: 'docs/phase0/tools/regen-manifest.js',
  status: problems.length ? 'FAIL — see problems' : 'PASS — internal consistency and founder-review closure checks passed (documentation package only; says nothing about code, CI or approvals)',
  product_name: 'Wayvro', product_name_locked: true,
  public_mobile_topology: { one_public_wayvro_app: true, rider_mode: true, approved_driver_partner_profile_and_mode: true, separate_public_rider_driver_apps: false, server_authorization_not_ui_mode_switch: true },
  requirements: {
    schema_version: register.schema_version, total: items.length, priority_counts: prio, unique_ids: new Set(ids).size === ids.length,
    inventory_rows: invRows.length, inventory_matches_json_ids_priorities_titles: invMismatch === 0 && invRows.length === items.length,
    v5_baseline_count: 511, phase0_added_ids: register.phase0 ? register.phase0.added_ids : [],
    phase0_disposition_counts: coverage.summary.by_disposition, all_items_have_phase0_block: notStamped === 0,
    requirements_register_sha256: sha(fs.readFileSync(path.join(ROOT, 'docs/requirements-register.json'))),
  },
  phase_plan: { phases: phaseNums, count: phaseNums.length, exactly_0_through_12: phaseNums.join(',') === '0,1,2,3,4,5,6,7,8,9,10,11,12' },
  risk_register: { table_row_count: riskIds.length, unique_table_ids: new Set(riskIds).size === riskIds.length, id_range: `${riskIds[0]}..${riskIds[riskIds.length - 1]}` },
  engineering_governance: { claude_md_present: fs.existsSync(path.join(ROOT, 'CLAUDE.md')), claude_md_modified_in_phase0: false, change_safety_doc_present: true, app_topology_doc_present: true, phase0_prompt_present: true, phase0_deliverables_dir: 'docs/phase0', codex_prompt_or_workflow_files: [], prohibited_separate_app_repo_paths_found: prohibited },
  file_integrity: { missing_backticked_local_file_references: missingRefs, empty_files: files.filter((f) => fs.statSync(path.join(ROOT, f)).size === 0), root_duplicate_files_removed_in_phase0: ['28_APP_SURFACES_AND_REPO_TOPOLOGY.md', 'PHASE_0_DISCOVERY_CLAUDE.md', 'requirements-register.json'], manifest_excludes_itself: true },
  founder_review_closure_checks: closureChecks,
  problems,
  important_note: 'PASS means internal package consistency checks passed. It does not mean legal approval, security certification, product-market fit, provider approval, founder approval of Phase 0 proposals, or that no future requirement can be discovered.',
};

if (CHECK) {
  const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
  const stale = !current || JSON.stringify(current.files) !== JSON.stringify(manifest.files);
  if (stale || problems.length) { console.error('CHECK FAILED', { stale, problems }); process.exit(1); }
  console.log(`check: OK (${files.length} files, manifest current, ${problems.length} problems)`);
} else {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  // Manifest hash of summary must be computed after summary is written; write summary first, then manifest including it.
  fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + '\n');
  const files2 = packageFiles();
  manifest.file_count_excluding_manifest = files2.length;
  manifest.files = files2.map((p) => { const b = fs.readFileSync(path.join(ROOT, p)); return { path: p, bytes: b.length, sha256: sha(b) }; });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${files2.length} files; summary status: ${summary.status}`);
  if (problems.length) { console.error('PROBLEMS:\n - ' + problems.join('\n - ')); process.exit(1); }
}
