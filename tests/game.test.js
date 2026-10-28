import test from 'node:test';
import assert from 'node:assert/strict';
import { newRoom, addPlayer, startRound, playDone, playDraw, setDraft, viewFor, emptyTable } from '../server/game.js';

const c = (suit, rank, copy = 0) => copy * 52 + suit * 13 + (rank - 1);
const [SP, HE, DI, CL] = [0, 1, 2, 3];

function room(opts) {
  const r = newRoom('TEST', opts);
  addPlayer(r, 'Bazsi', 'ta');
  addPlayer(r, 'Dad', 'tb');
  startRound(r);
  r.turn = 0;
  return r;
}

test('deal: 5 cards each from a 110-card deck, opponent hand hidden', () => {
  const r = room();
  assert.equal(r.players[0].hand.length, 5);
  assert.equal(r.players[1].hand.length, 5);
  assert.equal(r.deck.length, 100);
  const v = viewFor(r, 0);
  assert.equal(v.hand.length, 5);
  assert.equal(v.players[1].handCount, 5);
  assert.ok(!JSON.stringify(v).includes(JSON.stringify(r.players[1].hand)), 'opponent hand must not leak');
});

test('done: opening meld, hand shrinks, turn passes, wrong player refused', () => {
  const r = room();
  r.players[0].hand = [c(HE, 7), c(SP, 7), c(DI, 7), c(CL, 5), c(DI, 13)];
  const proposed = emptyTable();
  proposed[3] = [c(HE, 7), c(SP, 7), c(DI, 7)];
  assert.equal(playDone(r, 1, proposed).code, 'notYourTurn');
  assert.deepEqual(playDone(r, 0, proposed), { ok: true });
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.players[0].opened, true);
  assert.equal(r.turn, 1);
  assert.deepEqual(r.table[3], [c(HE, 7), c(SP, 7), c(DI, 7)]);
});

test('done: cannot cheat with cards you do not hold or by pulling table cards back', () => {
  const r = room();
  r.players[0].hand = [c(HE, 7), c(SP, 7), c(CL, 5), c(DI, 13), c(DI, 2)];
  const p = emptyTable();
  p[0] = [c(HE, 7), c(SP, 7), c(DI, 7)]; // 7♦ is not in hand
  assert.equal(playDone(r, 0, p).code, 'unknownCard');
  assert.equal(r.players[0].hand.length, 5);
});

test('draw: allowed with no play, refused (with hint) in strict mode when a play exists', () => {
  const r = room({ strict: true });
  r.players[0].hand = [c(HE, 7), c(HE, 8), c(HE, 9), c(CL, 5), c(DI, 13)];
  const refused = playDraw(r, 0);
  assert.equal(refused.code, 'mustPlay');
  assert.equal(refused.hint.length, 3);
  assert.equal(r.turn, 0);

  r.players[0].hand = [c(HE, 7), c(HE, 9), c(CL, 5), c(DI, 13), c(DI, 2)];
  const deckBefore = r.deck.length;
  assert.deepEqual(playDraw(r, 0), { ok: true });
  assert.equal(r.players[0].hand.length, 6);
  assert.equal(r.deck.length, deckBefore - 1);
  assert.equal(r.turn, 1);
});

test('draw: non-strict rooms never refuse', () => {
  const r = room({ strict: false });
  r.players[0].hand = [c(HE, 7), c(HE, 8), c(HE, 9), c(CL, 5), c(DI, 13)];
  assert.deepEqual(playDraw(r, 0), { ok: true });
});

test('going out wins the round, counts the win and alternates the starter', () => {
  const r = room();
  r.startIdx = 0;
  r.players[0].hand = [c(HE, 7), c(HE, 8), c(HE, 9)];
  const p = emptyTable();
  p[0] = [c(HE, 7), c(HE, 8), c(HE, 9)];
  playDone(r, 0, p);
  assert.equal(r.phase, 'over');
  assert.equal(r.winner, 0);
  assert.equal(r.players[0].wins, 1);
  assert.equal(r.startIdx, 1);
  startRound(r);
  assert.equal(r.turn, 1);
  assert.equal(r.phase, 'playing');
});

test('drafts are only accepted from the player whose turn it is', () => {
  const r = room();
  const t = emptyTable();
  assert.equal(setDraft(r, 1, t), false);
  assert.equal(setDraft(r, 0, t), true);
  assert.ok(viewFor(r, 1).draft, 'opponent sees the draft');
  assert.equal(viewFor(r, 0).draft, null);
});
