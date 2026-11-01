// HTTP (static files) + WebSocket (game) server. Authoritative: clients only propose
// a final table; the server validates it and owns hands, deck and turn order.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { viewFor } from './game.js';
import { CODE_RE, createRoom, joinRoom, findSeat, handleInRoom } from './handlers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DEBUG = process.env.OTLAPOS_DEBUG === '1';
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const base = path.join(ROOT, 'public'); // only public/ is served; everything else 404s
  const file = path.join(base, urlPath.slice(1));
  if (!file.startsWith(base + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------

const rooms = new Map();

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function broadcast(room) {
  room.lastActive = Date.now();
  room.players.forEach((p, i) => send(p.ws, { t: 'state', s: viewFor(room, i) }));
}

function attach(room, idx, ws) {
  const p = room.players[idx];
  if (p.ws && p.ws !== ws) {
    p.ws.ctx = null;
    p.ws.close(4000, 'replaced');
  }
  p.ws = ws;
  ws.ctx = { room, idx };
}

function onMessage(ws, msg) {
  switch (msg.t) {
    case 'create': {
      const code = String(msg.code ?? '').toUpperCase();
      if (!CODE_RE.test(code) || rooms.has(code)) return send(ws, { t: 'error', code: 'taken' });
      const { room, idx, token } = createRoom(code, msg);
      rooms.set(code, room);
      attach(room, idx, ws);
      send(ws, { t: 'joined', code, token, idx });
      return broadcast(room);
    }
    case 'join': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
      const r = joinRoom(room, msg);
      if (r.error) return send(ws, { t: 'error', code: r.error });
      attach(room, r.idx, ws);
      send(ws, { t: 'joined', code: room.code, token: r.token, idx: r.idx });
      return broadcast(room);
    }
    case 'rejoin': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      const idx = findSeat(room, msg.token);
      if (idx < 0) return send(ws, { t: 'error', code: 'noRoom', fatal: true });
      attach(room, idx, ws);
      send(ws, { t: 'joined', code: room.code, token: msg.token, idx });
      return broadcast(room);
    }
  }

  const ctx = ws.ctx;
  if (!ctx) return;
  const { room, idx } = ctx;
  room.lastActive = Date.now();
  const r = handleInRoom(room, idx, msg, DEBUG);
  if (r.reply) send(ws, r.reply);
  if (r.broadcast) broadcast(room);
  if (r.relayDraft) send(room.players[1 - idx]?.ws, { t: 'state', s: viewFor(room, 1 - idx) });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      onMessage(ws, msg);
    } catch (e) {
      console.error('handler error', e);
      send(ws, { t: 'error', code: 'server' });
    }
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    const p = ctx.room.players[ctx.idx];
    if (p && p.ws === ws) {
      p.ws = null;
      broadcast(ctx.room);
    }
  });
});

// Keep proxies from dropping idle sockets; evict dead ones; expire abandoned rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActive > ROOM_TTL_MS && room.players.every((p) => !p.ws)) rooms.delete(code);
  }
}, 25000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Öt lapos römi listening on http://localhost:${PORT}${DEBUG ? ' (debug hooks ON)' : ''}`);
});
