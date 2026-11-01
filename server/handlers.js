// Transport-agnostic message handling, shared by the Node server and the Cloudflare Durable Object.
import { addPlayer, startRound, playDone, playDraw, setDraft, newRoom } from './game.js';

export const CODE_RE = /^[A-Z]{4}$/;

export const cleanName = (s) =>
  String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Player';

export const newToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** First player creates the room. Returns { idx, token, room } */
export function createRoom(code, msg) {
  const room = newRoom(code, { strict: msg.strict !== false });
  const token = newToken();
  const idx = addPlayer(room, cleanName(msg.name), token);
  return { room, idx, token };
}

/** Second player joins and the round starts. Returns { idx, token } or { error } */
export function joinRoom(room, msg) {
  if (!room) return { error: 'noRoom' };
  if (room.players.length >= 2) return { error: 'roomFull' };
  const token = newToken();
  const idx = addPlayer(room, cleanName(msg.name), token);
  room.startIdx = Math.random() < 0.5 ? 0 : 1;
  startRound(room);
  return { idx, token };
}

export const findSeat = (room, token) =>
  room ? room.players.findIndex((p) => p.token === token) : -1;

/**
 * Messages from a seated player. Returns what the transport should do:
 * { reply?: msg to sender, broadcast?: bool, relayDraft?: bool }
 */
export function handleInRoom(room, idx, msg, debug = false) {
  switch (msg.t) {
    case 'draft':
      return setDraft(room, idx, msg.table) ? { relayDraft: true } : {};
    case 'done': {
      const r = playDone(room, idx, msg.table);
      return r.ok ? { broadcast: true } : { reply: { t: 'rejected', code: r.code, cell: r.cell } };
    }
    case 'draw': {
      const r = playDraw(room, idx);
      return r.ok ? { broadcast: true } : { reply: { t: 'rejected', code: r.code, hint: r.hint } };
    }
    case 'rematch': {
      if (room.phase !== 'over') return {};
      room.rematch[idx] = true;
      if (room.rematch.every(Boolean)) startRound(room);
      return { broadcast: true };
    }
    case 'debugSet': {
      if (!debug) return {};
      // test hook: { hands: [[ids],[ids]], table, turn, opened: [bool,bool] }
      if (msg.hands) room.players.forEach((p, i) => (p.hand = msg.hands[i] ?? p.hand));
      if (msg.table) room.table = msg.table;
      if (msg.opened) room.players.forEach((p, i) => (p.opened = !!msg.opened[i]));
      if (Number.isInteger(msg.turn)) room.turn = msg.turn;
      room.turnNo++;
      room.draft = null;
      return { broadcast: true };
    }
  }
  return {};
}
