// SPIKE-ONLY comparison gateway: raw `ws` server with the same HMAC handshake check (token in the query string for the
// spike). No rooms, no Redis fan-out, no protocol framing — it measures the floor cost of an authenticated upgrade.
// Usage: node dist/raw-ws-gateway.js <port>
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { verifyToken } from './shared.js';

const PORT = Number(process.argv[2] ?? 4301);
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rssMb: Math.round(process.memoryUsage().rss / 1048576), port: PORT }));
    return;
  }
  res.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  const token = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
  if (!verifyToken(token, Date.now())) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => ws.send('{"type":"hello"}'));
});
http.listen(PORT, '127.0.0.1', () => console.log(`raw ws gateway listening on ${PORT}`));
