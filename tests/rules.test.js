import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMeld, checkTurn, canPlay, partition, cardInfo, makeDeck, shuffle } from '../shared/rules.js';

// helpers: suit 0♠ 1♥ 2♦ 3♣ ; deck copy 0/1 ; rank 1..13 ; jokers 104..109
const c = (suit, rank, copy = 0) => copy * 52 + suit * 13 + (rank - 1);
const S = 0, H = 1, D = 2, C = 3;
const J = [104, 105, 106, 107, 108, 109];

test('cardInfo maps ids', () => {
  assert.deepEqual(cardInfo(c(H, 7, 1)), { id: 52 + 13 + 6, joker: false, suit: 1, rank: 7 });
  assert.equal(cardInfo(104).joker, true);
});

test('terc: valid / invalid', () => {
  assert.ok(analyzeMeld([c(S, 7), c(H, 7), c(D, 7)]).valid);
  assert.ok(analyzeMeld([c(S, 7), c(H, 7), c(D, 7), c(C, 7)]).valid);
  assert.ok(analyzeMeld([c(S, 7), c(H, 7, 1), c(D, 7)]).valid); // second deck copy is fine
  assert.ok(!analyzeMeld([c(S, 7), c(S, 7, 1), c(D, 7)]).valid); // same suit twice
  assert.ok(!analyzeMeld([c(S, 7), c(H, 7)]).valid); // too short
  assert.ok(!analyzeMeld([c(S, 7), c(H, 7), c(D, 8)]).valid);
  assert.ok(!analyzeMeld([c(S, 7), c(H, 7), c(D, 7), c(C, 7), J[0]]).valid); // 5 cards
});

test('terc with joker', () => {
  const a = analyzeMeld([c(S, 7), c(H, 7), J[0]]);
  assert.ok(a.valid);
  assert.equal(a.kind, 'terc');
  assert.equal(a.slots[2].as.rank, 7);
  assert.ok(analyzeMeld([c(S, 7), c(H, 7), c(D, 7), J[0]]).valid);
  assert.ok(!analyzeMeld([c(S, 7), J[0], J[1]]).valid); // only one real card
  assert.ok(!analyzeMeld([c(S, 7), c(S, 7, 1), J[0]]).valid);
});

test('run: basics, ace low/high, no wrap', () => {
  assert.ok(analyzeMeld([c(H, 5), c(H, 6), c(H, 7)]).valid);
  assert.ok(analyzeMeld([c(H, 7), c(H, 5), c(H, 6)]).valid); // order irrelevant
  assert.ok(analyzeMeld([c(H, 1), c(H, 2), c(H, 3)]).valid); // A-2-3
  assert.ok(analyzeMeld([c(H, 12), c(H, 13), c(H, 1)]).valid); // Q-K-A
  assert.ok(!analyzeMeld([c(H, 13), c(H, 1), c(H, 2)]).valid); // K-A-2 wraps
  assert.ok(!analyzeMeld([c(H, 5), c(H, 6), c(D, 7)]).valid); // mixed suits
  assert.ok(!analyzeMeld([c(H, 5), c(H, 5, 1), c(H, 6)]).valid); // duplicate rank
  assert.ok(!analyzeMeld([c(H, 5), c(H, 6), c(H, 8)]).valid); // gap
  const all = Array.from({ length: 13 }, (_, i) => c(S, i + 1));
  assert.ok(analyzeMeld(all).valid); // A..K
  assert.ok(analyzeMeld([...all.slice(1), c(S, 1, 1)]).valid); // 2..K,A(high)
  assert.ok(!analyzeMeld([...all, c(S, 1, 1)]).valid); // 14 cards
});

test('run with jokers', () => {
  const gap = analyzeMeld([c(H, 5), J[0], c(H, 7)]);
  assert.ok(gap.valid);
  assert.deepEqual(gap.slots[1].as, { suit: H, rank: 6 });
  assert.ok(analyzeMeld([c(H, 5), c(H, 6), J[0]]).valid); // joker extends
  assert.ok(analyzeMeld([c(H, 5), J[0], J[1], c(H, 8)]).valid); // two jokers fill gap
  assert.ok(!analyzeMeld([c(H, 5), J[0], c(H, 9)]).valid); // gap too big
  assert.ok(!analyzeMeld([c(H, 5), J[0], J[1]]).valid); // one natural only
  assert.ok(analyzeMeld([c(H, 12), c(H, 13), J[0]]).valid); // J-Q-K or Q-K-A
});

test('checkTurn: legality', () => {
  const run = [c(H, 5), c(H, 6), c(H, 7)];
  const empty = () => Array.from({ length: 5 }, () => []);
  // opening with a pure meld
  let r = checkTurn({ oldTable: empty(), hand: run, proposed: [run, [], [], [], []], opened: false });
  assert.ok(r.ok);
  // invalid meld
  r = checkTurn({ oldTable: empty(), hand: [c(H, 5), c(H, 6), c(H, 9)], proposed: [[c(H, 5), c(H, 6), c(H, 9)], [], [], [], []], opened: false });
  assert.deepEqual([r.ok, r.code, r.cell], [false, 'invalidMeld', 0]);
  // nothing placed
  r = checkTurn({ oldTable: empty(), hand: run, proposed: empty(), opened: false });
  assert.equal(r.code, 'nothingPlaced');
  // card not from hand
  r = checkTurn({ oldTable: empty(), hand: [c(H, 5)], proposed: [run, [], [], [], []], opened: true });
  assert.equal(r.code, 'unknownCard');
  // table card taken away
  const tbl = empty();
  tbl[0] = run;
  r = checkTurn({ oldTable: tbl, hand: [c(S, 1)], proposed: [[c(H, 5), c(H, 6)], [], [], [], []], opened: true });
  assert.equal(r.code, 'missingCard');
  // unopened player may not touch table: adding a card to an old meld isn't a pure meld
  r = checkTurn({ oldTable: tbl, hand: [c(H, 8)], proposed: [[...run, c(H, 8)], [], [], [], []], opened: false });
  assert.equal(r.code, 'needOpening');
  // opened player can extend
  r = checkTurn({ oldTable: tbl, hand: [c(H, 8)], proposed: [[...run, c(H, 8)], [], [], [], []], opened: true });
  assert.ok(r.ok);
  // unopened player: pure meld + rearranging afterwards is allowed
  const t2 = empty();
  t2[0] = [c(H, 5), c(H, 6), c(H, 7), c(H, 8)];
  const pure = [c(S, 3), c(D, 3), c(C, 3)];
  r = checkTurn({
    oldTable: t2,
    hand: [...pure, c(H, 9)],
    proposed: [[c(H, 5), c(H, 6), c(H, 7), c(H, 8), c(H, 9)], pure, [], [], []],
    opened: false,
  });
  assert.ok(r.ok);
});

test('canPlay: not opened needs a pure meld in hand', () => {
  assert.equal(canPlay({ table: [], hand: [c(H, 5), c(D, 9), c(S, 2), c(C, 12), c(H, 1)], opened: false }).can, false);
  const r = canPlay({ table: [], hand: [c(H, 5), c(H, 6), c(D, 9), c(H, 7), c(C, 12)], opened: false });
  assert.ok(r.can);
  assert.deepEqual(r.cards.sort((a, b) => a - b), [c(H, 5), c(H, 6), c(H, 7)].sort((a, b) => a - b));
  // joker helps
  assert.ok(canPlay({ table: [], hand: [c(H, 5), J[0], c(D, 9), c(S, 2), c(C, 12)], opened: false }).can === false);
  assert.ok(canPlay({ table: [], hand: [c(H, 5), J[0], c(H, 6), c(S, 2), c(C, 12)], opened: false }).can);
  // table is off limits while unopened
  assert.equal(canPlay({ table: [c(H, 5), c(H, 6), c(H, 7)], hand: [c(H, 8)], opened: false }).can, false);
});

test('canPlay: opened players can extend / rearrange', () => {
  const table = [c(H, 5), c(H, 6), c(H, 7)];
  assert.ok(canPlay({ table, hand: [c(H, 8), c(S, 1), c(D, 2), c(C, 9), c(S, 12)], opened: true }).can);
  assert.equal(canPlay({ table, hand: [c(S, 1), c(D, 2), c(C, 9), c(S, 12), c(H, 11)], opened: true }).can, false);
  // borrow: run 5♥6♥7♥8♥ lets 5♥ go: hand 5♠ 5♦ → terc with the borrowed 5♥
  const t2 = [c(H, 5), c(H, 6), c(H, 7), c(H, 8)];
  const r = canPlay({ table: t2, hand: [c(S, 5), c(D, 5), c(C, 12), c(S, 1), c(D, 11)], opened: true });
  assert.ok(r.can);
  // split: 5-6-7-8-9-10 can be split to give 8♥ a home? hand 8♠ 8♦ → terc with 8♥ leaves 5-6-7 and 9-10 (invalid)
  const t3 = [c(H, 5), c(H, 6), c(H, 7), c(H, 8), c(H, 9), c(H, 10), c(H, 11)];
  assert.ok(canPlay({ table: t3, hand: [c(S, 8), c(D, 8), c(C, 12), c(S, 1), c(D, 3)], opened: true }).can); // 5-6-7 / 9-10-11
  const t4 = [c(H, 5), c(H, 6), c(H, 7), c(H, 8), c(H, 9), c(H, 10)];
  assert.equal(canPlay({ table: t4, hand: [c(S, 8), c(D, 8), c(C, 13), c(S, 1), c(D, 3)], opened: true }).can, false);
});

test('canPlay: jokers can be freed and reused', () => {
  // table: 9♠ 10♠ JOKER (joker = J♠ or 8♠) and terc 4♥ 4♦ 4♣. Hand: J♠ → replaces joker; joker joins terc.
  const table = [c(S, 9), c(S, 10), J[0], c(H, 4), c(D, 4), c(C, 4)];
  assert.ok(canPlay({ table, hand: [c(S, 2), c(S, 11), c(D, 13), c(H, 13), c(C, 1)], opened: true }).can);
  // taking only the joker for a pure hand meld is impossible as it breaks the run:
  assert.equal(canPlay({ table, hand: [c(S, 2), c(D, 13), c(H, 12), c(C, 1), c(H, 9)], opened: true }).can, false);
  // hand joker alone can extend a table meld
  assert.ok(canPlay({ table: [c(H, 5), c(H, 6), c(H, 7)], hand: [J[1], c(S, 2), c(D, 9), c(C, 12), c(H, 1)], opened: true }).can);
});

test('canPlay: joker-liberation requires re-homing', () => {
  // table: terc 7♥ 7♦ JOKER(=7♠/7♣). hand: 7♠ 7♣ ... → 7♥7♦7♠7♣ four-terc, joker left homeless → must rejoin
  const table = [c(H, 7), c(D, 7), J[0], c(S, 3), c(S, 4), c(S, 5)];
  // hand has 7♠: terc 7♥7♦7♠ + joker joins 3♠4♠5♠ (as 6♠) → valid
  assert.ok(canPlay({ table, hand: [c(S, 7), c(C, 12), c(D, 1), c(H, 12), c(S, 13)], opened: true }).can);
});

test('partition finds exact covers and rejects leftovers', () => {
  const ok = [c(H, 5), c(H, 6), c(H, 7), c(S, 9), c(D, 9), c(C, 9), c(S, 9, 1), c(S, 10), c(S, 11), J[0]];
  const p = partition(ok);
  assert.ok(p);
  assert.equal(p.flat().length, ok.length);
  for (const m of p) assert.ok(analyzeMeld(m).valid);
  assert.equal(partition([c(H, 5), c(H, 6), c(H, 7), c(S, 1)]), null);
  assert.ok(partition([c(H, 5), c(H, 6), c(H, 7), J[0], J[1]]));
});

// ---- randomized: build random valid tables, take a card out → solver must say "can play"
function randomValidTable(rnd) {
  const deck = shuffle(makeDeck(), rnd);
  const melds = [];
  const pool = new Map(); // faceKey -> ids
  for (const id of deck) {
    const k = cardInfo(id);
    if (k.joker) continue;
    const f = k.suit * 13 + k.rank - 1;
    if (!pool.has(f)) pool.set(f, []);
    pool.get(f).push(id);
  }
  const takeFace = (s, r) => pool.get(s * 13 + r - 1)?.pop();
  const meldCount = 3 + Math.floor(rnd() * 8);
  for (let m = 0; m < meldCount; m++) {
    if (rnd() < 0.5) {
      const s = Math.floor(rnd() * 4), start = 1 + Math.floor(rnd() * 11), len = 3 + Math.floor(rnd() * 4);
      const ids = [];
      for (let r = start; r < start + len && r <= 13; r++) {
        const id = takeFace(s, r);
        if (id === undefined) { ids.length = 0; break; }
        ids.push(id);
      }
      if (ids.length >= 3) melds.push(ids);
    } else {
      const r = 1 + Math.floor(rnd() * 13);
      const ids = [0, 1, 2, 3].map((s) => takeFace(s, r)).filter((x) => x !== undefined);
      if (ids.length >= 3) melds.push(ids.slice(0, 3 + Math.floor(rnd() * (ids.length - 2))));
    }
  }
  return melds;
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('randomized: removing a card from a valid table is always replayable', () => {
  const rnd = mulberry(12345);
  let checked = 0;
  const t0 = Date.now();
  for (let i = 0; i < 150; i++) {
    const melds = randomValidTable(rnd);
    const flat = melds.flat();
    if (flat.length < 8) continue;
    assert.ok(partition(flat), 'generated table must be partitionable');
    const out = flat[Math.floor(rnd() * flat.length)];
    const table = flat.filter((x) => x !== out);
    const hand = [out, c(S, 1), c(S, 1, 1), c(D, 13), c(C, 6)].filter((x, idx, a) => a.indexOf(x) === idx);
    const res = canPlay({ table: flat.filter((x) => x !== out), hand, opened: true });
    // table minus `out` might itself be invalid, but placing `out` back gives a valid layout, so a play exists
    assert.ok(res.can, `seed iter ${i}: expected a play`);
    checked++;
  }
  assert.ok(checked > 50);
  assert.ok(Date.now() - t0 < 15000, 'solver too slow');
});

test('solver stays fast on big tables with no play', () => {
  const rnd = mulberry(99);
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const flat = randomValidTable(rnd).flat();
    if (flat.length < 12) continue;
    // hand of junk-ish cards; whatever the answer is, it must come back quickly and be consistent
    const hand = [c(S, 2, 1), c(H, 13, 1), c(D, 7, 1), c(C, 1, 1), c(S, 9, 1)];
    const res = canPlay({ table: flat, hand, opened: true });
    assert.ok([true, false, null].includes(res.can));
    if (res.can) {
      const handSet = new Set(hand);
      assert.ok(res.cards.length >= 1 && res.cards.every((x) => handSet.has(x)));
      for (const m of res.melds) assert.ok(analyzeMeld(m).valid);
      assert.equal(res.melds.flat().length >= flat.length, true);
    }
    n++;
  }
  assert.ok(n > 10);
  assert.ok(Date.now() - t0 < 15000);
});
