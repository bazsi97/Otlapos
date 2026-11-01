// Game state + turn logic for one room. No networking in here.
import { HAND_SIZE, MAX_SLOTS, checkTurn, canPlay, cardInfo, makeDeck, shuffle } from '../public/shared/rules.js';

export function newRoom(code, { strict = true } = {}) {
  return {
    code,
    strict,
    players: [],
    phase: 'lobby', // lobby | playing | over
    table: emptyTable(),
    deck: [],
    turn: 0,
    turnNo: 0,
    startIdx: 0,
    draft: null,
    fresh: [],
    winner: null,
    log: [],
    rematch: [false, false],
    lastActive: Date.now(),
  };
}

export const emptyTable = () => [];
const compact = (table) => table.filter((c) => c.length > 0);

export function addPlayer(room, name, token) {
  const p = { name, token, hand: [], opened: false, wins: 0, ws: null };
  room.players.push(p);
  return room.players.length - 1;
}

export function startRound(room, rnd = Math.random) {
  room.deck = shuffle(makeDeck(), rnd);
  room.table = emptyTable();
  for (const p of room.players) {
    p.hand = room.deck.splice(0, HAND_SIZE);
    p.opened = false;
  }
  room.turn = room.startIdx;
  room.turnNo = 1;
  room.phase = 'playing';
  room.winner = null;
  room.draft = null;
  room.fresh = [];
  room.rematch = [false, false];
  room.log = [{ k: 'start', p: room.turn }];
}

const pushLog = (room, e) => {
  room.log.push(e);
  if (room.log.length > 40) room.log.shift();
};

function endTurn(room) {
  room.turn = 1 - room.turn;
  room.turnNo++;
  room.draft = null;
}

/** Player `idx` ends their turn with `proposed` as the new table. */
export function playDone(room, idx, proposed) {
  if (room.phase !== 'playing') return { ok: false, code: 'notPlaying' };
  if (room.turn !== idx) return { ok: false, code: 'notYourTurn' };
  const p = room.players[idx];
  const res = checkTurn({ oldTable: room.table, hand: p.hand, proposed, opened: p.opened });
  if (!res.ok) return res;

  const placed = new Set(res.placed);
  p.hand = p.hand.filter((id) => !placed.has(id));
  p.opened = true;
  room.table = compact(proposed).map((cell) => cell.slice());
  room.fresh = res.placed;
  pushLog(room, { k: 'played', p: idx, n: res.placed.length });

  if (p.hand.length === 0) {
    room.phase = 'over';
    room.winner = idx;
    room.draft = null;
    p.wins++;
    pushLog(room, { k: 'won', p: idx });
    room.startIdx = 1 - room.startIdx;
  } else {
    endTurn(room);
  }
  return { ok: true };
}

/**
 * Player `idx` draws instead of playing. In strict mode this is refused when the hand itself
 * contains a terc or row without jokers (returns those cards as a hint).
 */
export function playDraw(room, idx) {
  if (room.phase !== 'playing') return { ok: false, code: 'notPlaying' };
  if (room.turn !== idx) return { ok: false, code: 'notYourTurn' };
  const p = room.players[idx];
  if (room.strict) {
    // You only HAVE to play when your own hand holds a terc or row of real cards.
    // Jokers and adding to / rearranging the table never force you.
    const naturals = p.hand.filter((id) => !cardInfo(id).joker);
    const r = canPlay({ table: [], hand: naturals, opened: false });
    if (r.can === true) return { ok: false, code: 'mustPlay', hint: r.cards };
  }
  if (room.deck.length > 0) p.hand.push(room.deck.pop());
  pushLog(room, { k: 'drew', p: idx });
  endTurn(room);
  return { ok: true };
}

export function setDraft(room, idx, table) {
  if (room.phase !== 'playing' || room.turn !== idx) return false;
  if (
    !Array.isArray(table) ||
    table.length > MAX_SLOTS ||
    !table.every((c) => Array.isArray(c) && c.length <= 20 && c.every(Number.isInteger))
  ) {
    return false;
  }
  room.draft = table;
  return true;
}

/** What `idx` is allowed to see. Opponent's hand is reduced to a count. */
export function viewFor(room, idx) {
  return {
    code: room.code,
    you: idx,
    phase: room.phase,
    strict: room.strict,
    turn: room.turn,
    turnNo: room.turnNo,
    table: compact(room.table),
    draft: room.turn !== idx ? room.draft : null,
    deckCount: room.deck.length,
    fresh: room.fresh,
    winner: room.winner,
    rematch: room.rematch,
    log: room.log.slice(-6),
    hand: room.players[idx]?.hand ?? [],
    players: room.players.map((p) => ({
      name: p.name,
      handCount: p.hand.length,
      opened: p.opened,
      connected: !!p.ws,
      wins: p.wins,
    })),
  };
}
