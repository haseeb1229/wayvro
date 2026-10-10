// SPIKE-ONLY comparison gateway WITHOUT NestJS: plain node:http + socket.io + Redis adapter, same auth middleware and
// options as gateway.ts. Used only to attribute connection cost (Nest wrapper vs Socket.IO vs OS). Usage: node dist/plain-gateway.js <port>
import { createServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { REDIS_URL, verifyToken } from './shared.js';

const PORT = Number(process.argv[2] ?? 4201);
const pub = new Redis(REDIS_URL);
const sub = pub.duplicate();
await Promise.all([new Promise((r) => pub.once('ready', r)), new Promise((r) => sub.once('ready', r))]);

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rssMb: Math.round(process.memoryUsage().rss / 1048576), port: PORT }));
    return;
  }
  res.writeHead(404).end();
});
const io = new Server(http, { transports: ['websocket'], pingInterval: 10000, pingTimeout: 5000, adapter: createAdapter(pub, sub) });
io.use((socket, next) => {
  const claims = verifyToken((socket.handshake.auth as { token?: unknown }).token, Date.now());
  if (!claims) return next(new Error('unauthorized'));
  socket.data = { sub: claims.sub, entityId: claims.entityId };
  void socket.join(`entity:${claims.entityId}`);
  next();
});
http.listen(PORT, '127.0.0.1', () => console.log(`plain gateway listening on ${PORT}`));
