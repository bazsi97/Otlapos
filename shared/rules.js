// Öt lapos römi – rules engine. Pure functions, shared by server (authoritative)
// and browser (live feedback). No DOM / Node APIs in here.
//
// Card ids: 0..103 are the natural cards of two 52-card decks, 104..109 are jokers.
//   id -> deck = floor(id / 52), within deck: suit = floor(r / 13), rank = r % 13 + 1
// Suits: 0 ♠, 1 ♥, 2 ♦, 3 ♣.  Ranks: 1 = Ace … 13 = King.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const NATURALS = 104;
export const TOTAL_CARDS = 110;
export const HAND_SIZE = 5;
export const MAX_TERC = 4;
export const MAX_RUN = 13;

export function cardInfo(id) {
  if (id >= NATURALS) return { id, joker: true };
  const r = id % 52;
  return { id, joker: false, suit: Math.floor(r / 13), rank: (r % 13) + 1 };
}

export function makeDeck() {
  return Array.from({ length: TOTAL_CARDS }, (_, i) => i);
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Single meld analysis
// ---------------------------------------------------------------------------

const INVALID = { valid: false };

/**
 * Is this group of cards a legal terc or row?
 * Returns { valid, kind: 'terc'|'run', slots: [{ id, as }] } where `as` is null for
 * natural cards and { suit, rank } for a joker (what it currently stands for).
 * Slots are in display order (runs: ascending; tercs: by suit).
 * Rules: ≥3 cards, ≥2 natural cards (jokers can't carry a meld alone).
 *   terc: 3–4 cards, same rank, all different suits.
 *   run : 3–13 cards, same suit, consecutive. Ace low (A-2-3) or high (Q-K-A), no wrap.
 */
export function analyzeMeld(ids) {
  const n = ids.length;
  if (n < 3) return INVALID;
  const nat = [];
  const jokers = [];
  for (const id of ids) {
    const c = cardInfo(id);
    (c.joker ? jokers : nat).push(c);
  }
  if (nat.length < 2) return INVALID;

  if (n <= MAX_TERC && nat.every((c) => c.rank === nat[0].rank)) {
    const used = new Set(nat.map((c) => c.suit));
    if (used.size === nat.length) {
      const rank = nat[0].rank;
      const free = [0, 1, 2, 3].filter((s) => !used.has(s));
      const slots = nat
        .slice()
        .sort((a, b) => a.suit - b.suit)
        .map((c) => ({ id: c.id, as: null }));
      jokers.forEach((j, i) => slots.push({ id: j.id, as: { suit: free[i], rank } }));
      return { valid: true, kind: 'terc', slots };
    }
  }

  if (n <= MAX_RUN && nat.every((c) => c.suit === nat[0].suit)) {
    const suit = nat[0].suit;
    // positions 1..14: 1 = low ace, 2..13 = ranks, 14 = high ace
    for (let p = 1; p + n - 1 <= 14; p++) {
      const end = p + n - 1;
      const at = new Map();
      let ok = true;
      for (const c of nat) {
        const q = c.rank === 1 ? (p === 1 ? 1 : 14) : c.rank;
        if (q < p || q > end || at.has(q)) {
          ok = false;
          break;
        }
        at.set(q, c);
      }
      if (!ok) continue;
      let ji = 0;
      const slots = [];
      for (let q = p; q <= end; q++) {
        if (at.has(q)) slots.push({ id: at.get(q).id, as: null });
        else slots.push({ id: jokers[ji++].id, as: { suit, rank: ((q - 1) % 13) + 1 } });
      }
      return { valid: true, kind: 'run', slots };
    }
  }
  return INVALID;
}

// ---------------------------------------------------------------------------
// Whole-turn validation (used by server for the real check, by client for feedback)
// ---------------------------------------------------------------------------

const fail = (code, extra) => ({ ok: false, code, ...extra });

/**
 * oldTable : array of cells (arrays of ids) as it was when the turn started
 * hand     : ids in the player's hand when the turn started
 * proposed : array of cells the player wants to end the turn with
 * opened   : has the player already put down a meld in an earlier turn?
 *
 * A turn is legal when:
 *  - every card that was on the table is still on the table (nothing goes back to a hand)
 *  - only cards from the player's own hand were added, and at least one
 *  - every non-empty cell is a valid terc or row
 *  - if the player hasn't opened yet, at least one cell is made purely of their hand cards
 */
export function checkTurn({ oldTable, hand, proposed, opened }) {
  if (
    !Array.isArray(proposed) ||
    proposed.length !== oldTable.length ||
    !proposed.every((c) => Array.isArray(c))
  ) {
    return fail('shape');
  }
  const oldIds = new Set(oldTable.flat());
  const handSet = new Set(hand);
  const seen = new Set();
  for (const cell of proposed) {
    for (const id of cell) {
      if (!Number.isInteger(id) || id < 0 || id >= TOTAL_CARDS) return fail('unknownCard');
      if (seen.has(id)) return fail('dupCard');
      if (!oldIds.has(id) && !handSet.has(id)) return fail('unknownCard');
      seen.add(id);
    }
  }
  for (const id of oldIds) if (!seen.has(id)) return fail('missingCard');

  const placed = [...seen].filter((id) => !oldIds.has(id));
  if (placed.length === 0) return fail('nothingPlaced');

  let pure = false;
  for (let i = 0; i < proposed.length; i++) {
    const cell = proposed[i];
    if (cell.length === 0) continue;
    if (!analyzeMeld(cell).valid) return fail('invalidMeld', { cell: i });
    if (cell.every((id) => !oldIds.has(id))) pure = true;
  }
  if (!opened && !pure) return fail('needOpening');
  return { ok: true, placed };
}

// ---------------------------------------------------------------------------
// "Can this player play anything?"  (needed to enforce: if you can play, you must)
// ---------------------------------------------------------------------------
//
// Exact search: can the table cards, plus at least one hand card, be re-partitioned
// into valid melds? Table cards are mandatory (every one must end up in a meld),
// hand cards are optional (but at least one must be used). Because the cards come
// from only 52 distinct faces, the search state is just a count vector, so failed
// states are memoised. A node budget guards against pathological tables; running
// out of budget yields `null` ("unknown"), which callers treat as "let them draw".

const BUDGET = Symbol('budget');

function search(tableIds, handIds, budget, needHand = true) {
  const T = Array.from({ length: 52 }, () => []);
  const H = Array.from({ length: 52 }, () => []);
  const Tj = [];
  const Hj = [];
  for (const id of tableIds) {
    const c = cardInfo(id);
    if (c.joker) Tj.push(id);
    else T[c.suit * 13 + c.rank - 1].push(id);
  }
  for (const id of handIds) {
    const c = cardInfo(id);
    if (c.joker) Hj.push(id);
    else H[c.suit * 13 + c.rank - 1].push(id);
  }
  const src = [T, H];
  let used = 0; // hand cards currently placed in a meld
  let nodes = 0;
  const failed = new Set();
  const melds = [];

  const take = (s, idx) => {
    if (s === 1) used++;
    return src[s][idx].pop();
  };
  const give = (s, idx, id) => {
    if (s === 1) used--;
    src[s][idx].push(id);
  };

  const key = () => {
    let k = '';
    for (let i = 0; i < 52; i++) k += T[i].length;
    k += '|';
    for (let i = 0; i < 52; i++) k += H[i].length;
    return `${k}|${Tj.length}|${Hj.length}|${used > 0 ? 1 : 0}`;
  };

  // Add `jk` jokers (table jokers first, then hand jokers) to `group`, then call cont().
  const withJokers = (group, jk, cont) => {
    for (let a = Math.min(jk, Tj.length); a >= 0; a--) {
      const b = jk - a;
      if (b > Hj.length) continue;
      const taken = [];
      for (let i = 0; i < a; i++) taken.push(Tj.pop());
      for (let i = 0; i < b; i++) {
        taken.push(Hj.pop());
        used++;
      }
      group.push(...taken);
      if (cont()) return true;
      group.length -= taken.length;
      for (let i = 0; i < b; i++) {
        Hj.push(taken.pop());
        used--;
      }
      for (let i = 0; i < a; i++) Tj.push(taken.pop());
    }
    return false;
  };

  const finish = (group) => {
    melds.push(group.slice());
    if (rec()) return true;
    melds.pop();
    return false;
  };

  // Enumerate every meld that contains the anchor card (natural at index x, from source xs).
  const expand = (xs, x) => {
    const suit = (x / 13) | 0;
    const rank = (x % 13) + 1;
    const xid = take(xs, x);
    const group = [xid];

    // --- terc containing the anchor
    const others = [];
    for (let s = 0; s < 4; s++) if (s !== suit) others.push(s * 13 + rank - 1);
    const tercRec = (i) => {
      if (i === others.length) {
        const nat = group.length;
        if (nat < 2) return false;
        for (let jk = Math.max(0, 3 - nat); nat + jk <= MAX_TERC; jk++) {
          if (withJokers(group, jk, () => finish(group))) return true;
        }
        return false;
      }
      if (tercRec(i + 1)) return true;
      const idx = others[i];
      for (const sc of [1, 0]) {
        if (src[sc][idx].length) {
          const id = take(sc, idx);
          group.push(id);
          if (tercRec(i + 1)) return true;
          group.pop();
          give(sc, idx, id);
        }
      }
      return false;
    };
    if (tercRec(0)) return true;

    // --- runs containing the anchor (every window of length 3..13 that covers it)
    const positions = rank === 1 ? [1, 14] : [rank];
    for (const px of positions) {
      for (let L = MAX_RUN; L >= 3; L--) {
        for (let p = Math.max(1, px - L + 1); p <= Math.min(px, 15 - L); p++) {
          const end = p + L - 1;
          let natc = 1;
          const place = (q) => {
            if (q > end) return natc >= 2 && finish(group);
            if (q === px) return place(q + 1);
            const idx = suit * 13 + ((q - 1) % 13);
            for (const sc of [1, 0]) {
              if (src[sc][idx].length) {
                const id = take(sc, idx);
                group.push(id);
                natc++;
                if (place(q + 1)) return true;
                natc--;
                group.pop();
                give(sc, idx, id);
              }
            }
            if (Tj.length) {
              const j = Tj.pop();
              group.push(j);
              if (place(q + 1)) return true;
              group.pop();
              Tj.push(j);
            }
            if (Hj.length) {
              const j = Hj.pop();
              used++;
              group.push(j);
              if (place(q + 1)) return true;
              group.pop();
              used--;
              Hj.push(j);
            }
            return false;
          };
          if (place(p)) return true;
        }
      }
    }
    give(xs, x, xid);
    return false;
  };

  function rec() {
    if (++nodes > budget) throw BUDGET;
    let x = -1;
    for (let i = 0; i < 52; i++) {
      if (T[i].length) {
        x = i;
        break;
      }
    }
    if (x < 0 && (used > 0 || !needHand) && Tj.length === 0) return true;
    const k = key();
    if (failed.has(k)) return false;
    let found = false;
    if (x >= 0) {
      found = expand(0, x);
    } else {
      // All table naturals are placed. Either no hand card is used yet, or table jokers
      // are still homeless: grow a new meld around some hand card.
      for (let i = 0; i < 52 && !found; i++) if (H[i].length) found = expand(1, i);
    }
    if (!found) failed.add(k);
    return found;
  }

  return rec() ? melds : null;
}

/**
 * Can the player make a legal play?
 *  - table : flat list of every card id currently on the table
 *  - hand  : the player's hand
 *  - opened: false → only melds made purely of hand cards count (table is off-limits)
 * Returns { can: true, cards, melds } | { can: false } | { can: null } (search budget hit).
 */
export function canPlay({ table, hand, opened, budget = 200000 }) {
  try {
    const melds = search(opened ? table : [], hand, budget);
    if (!melds) return { can: false };
    const handSet = new Set(hand);
    const cards = melds.flat().filter((id) => handSet.has(id));
    return { can: true, cards, melds };
  } catch (e) {
    if (e === BUDGET) return { can: null };
    throw e;
  }
}

/** Partition a set of cards entirely into valid melds, or null. Mostly for tests. */
export function partition(ids, budget = 200000) {
  try {
    return search(ids, [], budget, false) ?? null;
  } catch (e) {
    if (e === BUDGET) return null;
    throw e;
  }
}
