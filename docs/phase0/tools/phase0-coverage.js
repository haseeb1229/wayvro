#!/usr/bin/env node
/*
 * Phase 0 coverage generator (Node >= 18, no dependencies).
 *
 * Reads the canonical register (docs/requirements-register.json) and the Phase 0 disposition maps
 * (coverage-map-1/2/3.js for existing IDs, coverage-map-new.js for IDs added in Phase 0), then:
 *   1. validates that every register ID has exactly one disposition row and that no row references an unknown ID;
 *   2. writes docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json and .csv (generated artefacts — do not hand-edit);
 *   3. with --apply, adds the new Phase 0 IDs to the register (never deletes/renames an ID), stamps every item with a
 *      `phase0` block, bumps schema_version to 5.1 and appends the new IDs to docs/03_FEATURE_INVENTORY.md.
 *   Post-Phase-0 additions (coverage-map-additions.js, each with added_on/batch/source/approval) use the same validation
 *   and apply path but keep their own provenance: register notes, `phase0.dispositioned_on` = added_on, a separate
 *   `post_phase0_additions` register block and a separate dated block in docs/03 — never labelled as Phase 0 output.
 *
 * Usage:  node docs/phase0/tools/phase0-coverage.js [--apply] [--check]
 *   --check  exit non-zero if the register/inventory are out of sync with the maps (intended for CI later).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTER = path.join(ROOT, 'docs', 'requirements-register.json');
const INVENTORY = path.join(ROOT, 'docs', '03_FEATURE_INVENTORY.md');
const OUT_JSON = path.join(ROOT, 'docs', 'phase0', 'PHASE0_REQUIREMENT_COVERAGE.json');
const OUT_CSV = path.join(ROOT, 'docs', 'phase0', 'PHASE0_REQUIREMENT_COVERAGE.csv');
const PHASE0_DATE = '2026-10-09';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const CHECK = args.has('--check');

const existingMap = Object.assign({},
  require('./coverage-map-1.js'), require('./coverage-map-2.js'), require('./coverage-map-3.js'));
const newMap = require('./coverage-map-new.js');
const additionsMap = require('./coverage-map-additions.js');

const FIELDS = ['disposition', 'domain', 'target_phase', 'surfaces', 'test_families', 'dependencies', 'external_blocker', 'phase0_note'];
const DISPOSITIONS = new Set(['NOW', 'LATER', 'OUT_OF_SCOPE', 'EXTERNAL_DECISION']);
const FAMILY_TITLES = {
  B: 'B — Rider booking/search/service classes', D: 'D — Driver onboarding, marketplace and route execution',
  E: 'E — Dispatch/pricing/geospatial and marketplace controls', G: 'G — Payments, accounting and incentives',
  M: 'M — Driver marketplace, earnings and welfare', N: 'N — Safety, trust and incident response',
  Q: 'Q — Security, SRE, mobile quality and release governance', R: 'R — Operations, regulation, verticals and engineering rules',
  S: 'S — Remaining mobility/product edge cases', W: 'W — Public website, web booking and staff web ecosystem',
  A: 'A — Rider acquisition/account/accessibility',
};

function rowToObj(id, row) {
  if (!Array.isArray(row) || row.length !== 8) throw new Error(`Bad row for ${id}`);
  const o = { id };
  FIELDS.forEach((f, i) => (o[f] = row[i]));
  if (!DISPOSITIONS.has(o.disposition)) throw new Error(`Bad disposition for ${id}: ${o.disposition}`);
  if (!Number.isInteger(o.target_phase) || o.target_phase < 0 || o.target_phase > 12) throw new Error(`Bad phase for ${id}`);
  o.surfaces = String(o.surfaces).split(';').filter(Boolean);
  o.test_families = String(o.test_families).split(';').filter(Boolean);
  o.dependencies = String(o.dependencies).split(';').filter(Boolean);
  return o;
}

const register = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
const items = register.items;
const byId = new Map(items.map((it) => [it.id, it]));
const problems = [];

// 1. Validate coverage of existing IDs.
for (const it of items) {
  const inExisting = Object.prototype.hasOwnProperty.call(existingMap, it.id);
  const inNew = Object.prototype.hasOwnProperty.call(newMap, it.id);
  const inAdd = Object.prototype.hasOwnProperty.call(additionsMap, it.id);
  if (!inExisting && !inNew && !inAdd) problems.push(`Register ID ${it.id} has no disposition row`);
  if ([inExisting, inNew, inAdd].filter(Boolean).length > 1) problems.push(`ID ${it.id} present in more than one disposition map`);
}
for (const [id, def] of Object.entries(additionsMap)) {
  const has = (m) => Object.prototype.hasOwnProperty.call(m, id);
  if (has(existingMap) || has(newMap)) problems.push(`Addition ${id} collides with an existing map row`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(def.added_on || '') || !def.batch || !def.source || !def.approval) problems.push(`Addition ${id} lacks added_on/batch/source/approval`);
}
for (const id of Object.keys(existingMap)) if (!byId.has(id)) problems.push(`Map row ${id} not in register`);

// Build the merged coverage list (existing + new), using register metadata for priority/title.
const coverage = [];
for (const it of items) {
  const src = existingMap[it.id] || (newMap[it.id] && newMap[it.id].row) || (additionsMap[it.id] && additionsMap[it.id].row);
  if (!src) continue;
  const o = rowToObj(it.id, src);
  const addedAfter = additionsMap[it.id] ? additionsMap[it.id].added_on : null;
  coverage.push({ id: it.id, priority: it.priority, title: it.title, added_in_phase0: !!newMap[it.id], added_after_phase0: addedAfter, ...o });
}
for (const [id, def] of Object.entries(newMap)) {
  if (byId.has(id)) continue; // already applied
  const o = rowToObj(id, def.row);
  coverage.push({ id, priority: def.priority, title: def.title, added_in_phase0: true, added_after_phase0: null, ...o });
}
for (const [id, def] of Object.entries(additionsMap)) {
  if (byId.has(id)) continue; // already applied
  const o = rowToObj(id, def.row);
  coverage.push({ id, priority: def.priority, title: def.title, added_in_phase0: false, added_after_phase0: def.added_on, ...o });
}
coverage.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Dependency sanity: dependency tokens that look like requirement IDs must exist (ranges like R02-R06 allowed).
const known = new Set(coverage.map((c) => c.id));
const idRe = /^[A-Z]\d{2}$/;
for (const c of coverage) for (const d of c.dependencies) {
  if (/^[A-Z]\d{2}-[A-Z]\d{2}$/.test(d)) {
    const [a, b] = d.split('-');
    if (!known.has(a) || !known.has(b)) problems.push(`${c.id} depends on unknown range ${d}`);
  } else if (idRe.test(d) && !known.has(d)) problems.push(`${c.id} depends on unknown ID ${d}`);
}

if (problems.length) {
  console.error('VALIDATION PROBLEMS:\n - ' + problems.join('\n - '));
  process.exit(1);
}

// 2. Emit generated artefacts.
const summary = {
  generated_on: PHASE0_DATE,
  generator: 'docs/phase0/tools/phase0-coverage.js',
  total: coverage.length,
  last_addition_on: Object.values(additionsMap).map((d) => d.added_on).sort().pop() || null,
  by_disposition: {}, by_priority: {}, by_phase: {}, by_domain: {}, added_in_phase0: coverage.filter((c) => c.added_in_phase0).map((c) => c.id),
  added_after_phase0: coverage.filter((c) => c.added_after_phase0).map((c) => c.id),
  external_blocker_count: coverage.filter((c) => c.external_blocker).length,
};
for (const c of coverage) {
  summary.by_disposition[c.disposition] = (summary.by_disposition[c.disposition] || 0) + 1;
  summary.by_priority[c.priority] = (summary.by_priority[c.priority] || 0) + 1;
  summary.by_phase[c.target_phase] = (summary.by_phase[c.target_phase] || 0) + 1;
  summary.by_domain[c.domain] = (summary.by_domain[c.domain] || 0) + 1;
}
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, items: coverage }, null, 2) + '\n');
const csvEsc = (v) => '"' + String(Array.isArray(v) ? v.join(';') : v == null ? '' : v).replace(/"/g, '""') + '"';
const header = ['id', 'priority', 'title', 'added_in_phase0', 'added_after_phase0', ...FIELDS];
const csv = [header.join(',')].concat(coverage.map((c) => header.map((h) => csvEsc(c[h])).join(','))).join('\n') + '\n';
fs.writeFileSync(OUT_CSV, csv);
console.log(`coverage: ${coverage.length} rows -> ${path.relative(ROOT, OUT_JSON)}, ${path.relative(ROOT, OUT_CSV)}`);
console.log(JSON.stringify(summary.by_disposition), JSON.stringify(summary.by_priority));

// 3. Apply to canonical register + inventory.
if (APPLY) {
  const covById = new Map(coverage.map((c) => [c.id, c]));
  let added = 0;
  for (const [id, def] of Object.entries(newMap)) {
    if (byId.has(id)) continue;
    const item = {
      id, priority: def.priority, title: def.title, state: 'PROPOSED', owner: null, spec: null, acceptance_tests: [],
      release_gate: null, implementation_evidence: null,
      notes: `Added in Phase 0 (${PHASE0_DATE}) via docs/26 completeness closure; source: ${def.source}. Requires founder review.`,
    };
    items.push(item); byId.set(id, item); added++;
  }
  for (const [id, def] of Object.entries(additionsMap)) {
    if (byId.has(id)) continue;
    const item = {
      id, priority: def.priority, title: def.title, state: 'PROPOSED', owner: null, spec: null, acceptance_tests: [],
      release_gate: null, implementation_evidence: null,
      notes: `Added in the ${def.batch} (${def.added_on}) via docs/26 completeness closure; source: ${def.source}. Approval: ${def.approval}.`,
    };
    items.push(item); byId.set(id, item); added++;
  }
  // coverage-map-new.js is the canonical source for Phase 0-added IDs: keep register priority/title in sync with it.
  let synced = 0;
  for (const [id, def] of [...Object.entries(newMap), ...Object.entries(additionsMap)]) {
    const it = byId.get(id);
    if (it.title !== def.title || it.priority !== def.priority) { it.title = def.title; it.priority = def.priority; synced++; }
  }
  if (synced) console.log(`register: ${synced} Phase 0-added items re-synced from coverage-map-new.js`);
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const it of items) {
    const c = covById.get(it.id);
    it.phase0 = {
      disposition: c.disposition, domain: c.domain, target_phase: c.target_phase, surfaces: c.surfaces,
      test_families: c.test_families, dependencies: c.dependencies, external_blocker: c.external_blocker || null,
      note: c.phase0_note || null, dispositioned_on: c.added_after_phase0 || PHASE0_DATE,
    };
  }
  register.schema_version = '5.1';
  register.status = 'V5.1 PHASE-0 DISPOSITIONED BASELINE — FOUNDER REVIEW CLOSURE APPLIED / REQUIREMENTS PROPOSED / NOT IMPLEMENTATION-APPROVED';
  register.phase0 = {
    dispositioned_on: PHASE0_DATE, founder_review_closure_on: PHASE0_DATE, v5_baseline_count: 511,
    total: items.filter((it) => !Object.prototype.hasOwnProperty.call(additionsMap, it.id)).length, added_ids: Object.keys(newMap).sort(),
    closure_record: 'docs/phase0/PHASE0_CLOSURE_HANDOFF.md',
    coverage_artifact: 'docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json', generator: 'docs/phase0/tools/phase0-coverage.js',
    gap_report: 'docs/phase0/PHASE0_GAP_REPORT.md',
  };
  register.post_phase0_additions = {
    note: 'Requirements added after Phase 0 through the docs/26 completeness-closure protocol; source of truth: docs/phase0/tools/coverage-map-additions.js.',
    added_ids: Object.keys(additionsMap).sort(),
    total_after_additions: items.length,
    records: Object.fromEntries(Object.keys(additionsMap).sort().map((id) => {
      const d = additionsMap[id];
      return [id, { added_on: d.added_on, batch: d.batch, source: d.source, approval: d.approval }];
    })),
  };
  fs.writeFileSync(REGISTER, JSON.stringify(register, null, 2) + '\n');
  console.log(`register: ${added} new items added; total ${items.length}; phase0 block stamped on all items`);

  // Append new IDs to docs/03 in family order (idempotent); re-sync existing Phase 0 lines from the source map.
  let inv = fs.readFileSync(INVENTORY, 'utf8');
  for (const [id, def] of Object.entries(newMap)) {
    const line = new RegExp(`^- ${id} P[0-3] .*$`, 'm');
    const want = `- ${id} ${def.priority} ${def.title}`;
    if (line.test(inv) && !inv.includes(want + '\n') && !inv.endsWith(want)) { inv = inv.replace(line, want); console.log(`inventory: re-synced ${id}`); }
  }
  fs.writeFileSync(INVENTORY, inv);
  const missing = Object.keys(newMap).filter((id) => !new RegExp(`^- ${id} P[0-3] `, 'm').test(inv)).sort();
  if (missing.length) {
    const byFam = {};
    for (const id of missing) (byFam[id[0]] = byFam[id[0]] || []).push(id);
    let block = `\n# Phase 0 additions (${PHASE0_DATE}) — discovered gaps closed via docs/26 completeness closure\n\nEach item below was added in Phase 0 with a recorded source and disposition (see \`docs/phase0/PHASE0_GAP_REPORT.md\` and \`docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json\`). They remain PROPOSED until founder review.\n`;
    for (const fam of Object.keys(byFam).sort()) {
      block += `\n## ${FAMILY_TITLES[fam] || fam} (Phase 0 additions)\n`;
      for (const id of byFam[fam]) block += `- ${id} ${newMap[id].priority} ${newMap[id].title}\n`;
    }
    inv = inv.replace(/\s*$/, '\n') + block;
    fs.writeFileSync(INVENTORY, inv);
    console.log(`inventory: appended ${missing.length} new IDs to docs/03`);
  } else console.log('inventory: already up to date');

  // Post-Phase-0 additions: one dated block per batch, appended after the Phase 0 block (idempotent; re-synced on change).
  for (const [id, def] of Object.entries(additionsMap)) {
    const line = new RegExp(`^- ${id} P[0-3] .*$`, 'm');
    const want = `- ${id} ${def.priority} ${def.title}`;
    if (line.test(inv) && !inv.includes(want + '\n') && !inv.endsWith(want)) { inv = inv.replace(line, want); console.log(`inventory: re-synced ${id}`); }
  }
  const missingAdditions = Object.keys(additionsMap).filter((id) => !new RegExp(`^- ${id} P[0-3] `, 'm').test(inv)).sort();
  if (missingAdditions.length) {
    const byBatch = {};
    for (const id of missingAdditions) {
      const key = `${additionsMap[id].batch} (${additionsMap[id].added_on})`;
      (byBatch[key] = byBatch[key] || []).push(id);
    }
    for (const [batch, ids] of Object.entries(byBatch)) {
      let block = `\n# ${batch} — approved gaps closed via docs/26 completeness closure\n\nEach item below was added after Phase 0 with a recorded source and approval (see \`post_phase0_additions\` in \`docs/requirements-register.json\` and \`docs/phase0/PHASE0_REQUIREMENT_COVERAGE.json\`). They remain PROPOSED until implemented and verified.\n`;
      const byFam = {};
      for (const id of ids) (byFam[id[0]] = byFam[id[0]] || []).push(id);
      for (const fam of Object.keys(byFam).sort()) {
        block += `\n## ${FAMILY_TITLES[fam] || fam} (${batch})\n`;
        for (const id of byFam[fam]) block += `- ${id} ${additionsMap[id].priority} ${additionsMap[id].title}\n`;
      }
      inv = inv.replace(/\s*$/, '\n') + block;
    }
    console.log(`inventory: appended ${missingAdditions.length} post-Phase-0 IDs to docs/03`);
  }
  fs.writeFileSync(INVENTORY, inv);
}

if (CHECK) {
  const inv = fs.readFileSync(INVENTORY, 'utf8');
  const reg = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
  const invIds = new Set([...inv.matchAll(/^- ([A-Z]\d{2}) (P[0-3]) /gm)].map((m) => m[1]));
  const regIds = new Set(reg.items.map((i) => i.id));
  const diff = [...regIds].filter((x) => !invIds.has(x)).concat([...invIds].filter((x) => !regIds.has(x)));
  const notStamped = reg.items.filter((i) => !i.phase0).map((i) => i.id);
  if (diff.length || notStamped.length || reg.items.length !== coverage.length) {
    console.error('CHECK FAILED', { diff, notStamped, registerCount: reg.items.length, coverageCount: coverage.length });
    process.exit(1);
  }
  console.log(`check: OK (${reg.items.length} IDs consistent across register, inventory and coverage)`);
}
