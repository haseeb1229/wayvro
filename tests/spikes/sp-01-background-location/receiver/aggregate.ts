/**
 * SP-01 aggregator CLI (protocol §12). Reads the receiver's JSON-Lines data file (outside the repo) and writes the
 * aggregate as JSON + Markdown (aggregates only; suitable for results/ after review).
 *
 *   node receiver/aggregate.ts --data <rows.jsonl> --case TC-03 --out results/<name> \
 *     [--run <runId>|latest] [--interval-s 5] [--window-min 60] [--window-start online|<server ms>|<ISO>] [--grace-min 5] \
 *     [--set oem_class=XIAOMI --set config=GUIDED ...]
 *
 * --out is a path prefix: <prefix>.json and <prefix>.md are written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { aggregate, CAPTURE_SHEET_COLUMNS, toMarkdown, type SheetColumn } from './aggregate-core.ts';
import type { Row } from './rows.ts';

const { values } = parseArgs({
  options: {
    data: { type: 'string' },
    case: { type: 'string' },
    out: { type: 'string' },
    run: { type: 'string', default: 'latest' },
    'interval-s': { type: 'string', default: '5' },
    'window-min': { type: 'string', default: '60' },
    'window-start': { type: 'string', default: 'online' },
    'grace-min': { type: 'string', default: '5' },
    set: { type: 'string', multiple: true, default: [] },
  },
});

function fail(message: string): never {
  console.error(`sp01-aggregate: ${message}`);
  process.exit(2);
}

if (!values.data || !values.case || !values.out) fail('--data, --case and --out are required');
if (!/^TC-\d{2}[a-z0-9-]*$/i.test(values.case)) fail('--case must look like TC-03 (optionally with a suffix, e.g. TC-04-guided)');

const ws = values['window-start'];
const windowStart: 'online' | number = ws === 'online' ? 'online' : /^\d+$/.test(ws) ? Number(ws) : Date.parse(ws);
if (windowStart !== 'online' && !Number.isFinite(windowStart)) fail('--window-start must be online, server epoch ms or an ISO timestamp');

const rows: Row[] = readFileSync(values.data, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim() !== '')
  .map((l, i) => {
    try {
      return JSON.parse(l) as Row;
    } catch {
      return fail(`line ${String(i + 1)} of the data file is not JSON`);
    }
  });

const result = aggregate(rows, {
  runId: values.run,
  caseId: values.case.toUpperCase(),
  intervalS: Number(values['interval-s']),
  windowMin: Number(values['window-min']),
  windowStart,
  graceMin: Number(values['grace-min']),
});

const overrides: Partial<Record<SheetColumn, string>> = {};
for (const kv of values.set) {
  const eq = kv.indexOf('=');
  const key = kv.slice(0, eq) as SheetColumn;
  if (eq < 1 || !(CAPTURE_SHEET_COLUMNS as readonly string[]).includes(key)) fail(`--set ${kv}: unknown capture-sheet column`);
  overrides[key] = kv.slice(eq + 1);
}
const final = { ...result, sheetRow: { ...result.sheetRow, ...overrides } };
writeFileSync(`${values.out}.json`, `${JSON.stringify(final, null, 2)}\n`);
writeFileSync(`${values.out}.md`, toMarkdown(final));
console.log(
  `completeness ${String(final.points.completenessPct)} % (${String(final.points.receivedUnique)}/${String(final.points.expected)}), offers live/polled/recovered/lost ${String(final.offers.live)}/${String(final.offers.polled)}/${String(final.offers.recovered)}/${String(final.offers.lost)}`,
);
console.log(`wrote ${values.out}.json and ${values.out}.md`);
