// One Durable Object = one game room. Uses WebSocket hibernation, so an idle room costs
// nothing; game state is persisted to storage and survives eviction/restarts.
import { DurableObject } from 'cloudflare:workers';
import { viewFor } from '../server/game.js';
import { CODE_RE, createRoom, joinRoom, findSeat, handleInRoom } from '../server/handlers.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.debug = env.OTLAPOS_DEBUG === '1';
    this.room = null;
    // keep-alive pings from the client are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) ?? null;
    });
  }

  async fetch() {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---- helpers
  live(idx) {
    return this.ctx
      .getWebSockets()
      .filter((w) => w.readyState === 1 && w.deserializeAttachment()?.idx === idx);
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  async save() {
    for (const [i, p] of this.room.players.entries()) p.ws = this.live(i).length > 0;
    this.room.lastActive = Date.now();
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  broadcast() {
    this.room.players.forEach((p, i) => (p.ws = this.live(i).length > 0));
    this.room.players.forEach((_, i) => {
      const s = JSON.stringify({ t: 'state', s: viewFor(this.room, i) });
      for (const w of this.live(i)) w.send(s);
    });
  }

  attach(ws, idx) {
    for (const other of this.live(idx)) {
      if (other !== ws) {
        other.serializeAttachment(null);
        other.close(4000, 'replaced');
      }
    }
    ws.serializeAttachment({ idx });
  }

  // ---- WebSocket events
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const code = this.room?.code;

    switch (msg.t) {
      case 'create': {
        const want = String(msg.code ?? '').toUpperCase();
        if (this.room || !CODE_RE.test(want)) return this.send(ws, { t: 'error', code: 'taken' });
        const { room, idx, token } = createRoom(want, msg);
        this.room = room;
        this.attach(ws, idx);
        this.send(ws, { t: 'joined', code: want, token, idx });
        this.broadcast();
        return this.save();
      }
      case 'join': {
        const r = joinRoom(this.room, msg);
        if (r.error) return this.send(ws, { t: 'error', code: r.error });
        this.attach(ws, r.idx);
        this.send(ws, { t: 'joined', code, token: r.token, idx: r.idx });
        this.broadcast();
        return this.save();
      }
      case 'rejoin': {
        const idx = findSeat(this.room, msg.token);
        if (idx < 0) return this.send(ws, { t: 'error', code: 'noRoom', fatal: true });
        this.attach(ws, idx);
        this.send(ws, { t: 'joined', code, token: msg.token, idx });
        this.broadcast();
        return this.save();
      }
    }

    const idx = ws.deserializeAttachment()?.idx;
    if (idx === undefined || !this.room) return;
    const r = handleInRoom(this.room, idx, msg, this.debug);
    if (r.reply) this.send(ws, r.reply);
    if (r.broadcast) this.broadcast();
    if (r.relayDraft) {
      const s = JSON.stringify({ t: 'state', s: viewFor(this.room, 1 - idx) });
      for (const w of this.live(1 - idx)) w.send(s);
    }
    if (r.broadcast || r.relayDraft || r.reply) await this.save();
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
    if (this.room) {
      this.broadcast();
      await this.save();
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  // abandoned rooms are wiped after 12h of silence
  async alarm() {
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.room = null;
    }
  }
}
