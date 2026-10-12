/**
 * SP-01 receiver admin CLI (loopback only). Every command is timestamped by the receiver (server clock), which is what
 * the aggregator uses for detection times (protocol §12).
 *
 *   node receiver/admin.ts --port 8787 --token <t> status
 *   node receiver/admin.ts --port 8787 --token <t> restrict | unrestrict | force-offline | stop
 *   node receiver/admin.ts --port 8787 --token <t> restart-gateway [downMs]
 *   node receiver/admin.ts --port 8787 --token <t> mark <label>     e.g. mark revoke-all, mark wifi-on
 */
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { port: { type: 'string', default: '8787' }, token: { type: 'string' } },
});
const [cmd, arg] = positionals;
if (!cmd || !values.token) {
  console.error(
    'usage: node receiver/admin.ts --port <api port> --token <spike-local-only-…> <status|restrict|unrestrict|force-offline|restart-gateway [downMs]|mark <label>|stop>',
  );
  process.exit(2);
}
const body: Record<string, string | number> = { cmd };
if (cmd === 'mark') body['label'] = arg ?? '';
if (cmd === 'restart-gateway' && arg) body['downMs'] = Number(arg);

const res = await fetch(`http://127.0.0.1:${String(Number(values.port) + 2)}/admin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${values.token}` },
  body: JSON.stringify(body),
});
console.log(`${String(res.status)} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
