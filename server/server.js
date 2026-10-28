// HTTP (static files) + WebSocket (game) server. Authoritative: clients only propose
// a final table; the server validates it and owns hands, deck and turn order.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  newRoom, addPlayer, startRound, playDone, playDraw, setDraft, viewFor,
} from './game.js';

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

// Only these folders are served; everything else 404s.
const STATIC = { '/shared/': 'shared', '/': 'public' };

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const mount = urlPath.startsWith('/shared/') ? '/shared/' : '/';
  const rel = mount === '/' ? urlPath.slice(1) : urlPath.slice('/shared/'.length);
  const base = path.join(ROOT, STATIC[mount]);
  const file = path.join(base, rel);
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
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I / O

function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

const cleanName = (s) =>
  String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Player';

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
      const room = newRoom(makeCode(), { strict: msg.strict !== false });
      rooms.set(room.code, room);
      const token = randomBytes(16).toString('hex');
      const idx = addPlayer(room, cleanName(msg.name), token);
      attach(room, idx, ws);
      send(ws, { t: 'joined', code: room.code, token, idx });
      broadcast(room);
      return;
    }
    case 'join': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
      if (!room) return send(ws, { t: 'error', code: 'noRoom' });
      if (room.players.length >= 2) return send(ws, { t: 'error', code: 'roomFull' });
      const token = randomBytes(16).toString('hex');
      const idx = addPlayer(room, cleanName(msg.name), token);
      attach(room, idx, ws);
      send(ws, { t: 'joined', code: room.code, token, idx });
      room.startIdx = Math.random() < 0.5 ? 0 : 1;
      startRound(room);
      broadcast(room);
      return;
    }
    case 'rejoin': {
      const room = rooms.get(String(msg.code ?? '').toUpperCase());
      const idx = room ? room.players.findIndex((p) => p.token === msg.token) : -1;
      if (idx < 0) return send(ws, { t: 'error', code: 'noRoom', fatal: true });
      attach(room, idx, ws);
      send(ws, { t: 'joined', code: room.code, token: msg.token, idx });
      broadcast(room);
      return;
    }
  }

  const ctx = ws.ctx;
  if (!ctx) return;
  const { room, idx } = ctx;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'draft': {
      if (setDraft(room, idx, msg.table)) {
        send(room.players[1 - idx]?.ws, { t: 'state', s: viewFor(room, 1 - idx) });
      }
      return;
    }
    case 'done': {
      const r = playDone(room, idx, msg.table);
      if (!r.ok) return send(ws, { t: 'rejected', code: r.code, cell: r.cell });
      return broadcast(room);
    }
    case 'draw': {
      const r = playDraw(room, idx);
      if (!r.ok) return send(ws, { t: 'rejected', code: r.code, hint: r.hint });
      return broadcast(room);
    }
    case 'rematch': {
      if (room.phase !== 'over') return;
      room.rematch[idx] = true;
      if (room.rematch.every(Boolean)) startRound(room);
      return broadcast(room);
    }
    case 'debugSet': {
      if (!DEBUG) return;
      // test hook: { hands: [[ids],[ids]], table, turn, opened: [bool,bool] }
      if (msg.hands) room.players.forEach((p, i) => (p.hand = msg.hands[i] ?? p.hand));
      if (msg.table) room.table = msg.table;
      if (msg.opened) room.players.forEach((p, i) => (p.opened = !!msg.opened[i]));
      if (Number.isInteger(msg.turn)) room.turn = msg.turn;
      room.turnNo++;
      room.draft = null;
      return broadcast(room);
    }
  }
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
