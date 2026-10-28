import {
  SUITS, RANK_LABELS, cardInfo, analyzeMeld, checkTurn,
} from '/shared/rules.js';

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
const STR = {
  en: {
    subtitle: '5-card rummy for two',
    yourName: 'Your name', create: 'Create a room', or: 'or join one', join: 'Join',
    strict: 'Enforce forced play (you can’t draw if you’re able to play)',
    waitTitle: 'Waiting for your opponent…', waitHelp: 'Send them this link, or the room code:',
    copy: 'Copy', copied: 'Copied!', leave: 'Leave', reconnecting: 'Reconnecting…',
    done: 'Done ✔', draw: 'Draw', reset: 'Reset turn', sortSuit: 'Sort: suit', sortRank: 'Sort: number',
    rematch: 'Play again', viewTable: 'View table', waitingFor: 'Waiting for {n}…',
    youWon: 'You won! 🎉', someoneWon: '{n} won', winSub: 'First to run out of cards.',
    terc: 'terc', row: 'row', opened: 'opened', cards: 'cards', deck: 'deck',
    yourTurn: 'Your turn', turnOf: '{n}’s turn', theirDraft: '{n} is arranging the table…',
    hintOpen: 'Make a terc or row purely from your own cards first — then the whole table is yours. Or draw.',
    hintPlay: 'Drag cards onto the table (or tap a card, then a slot). Play something, or draw.',
    okDone: 'Everything checks out — press Done.',
    err_invalidMeld: 'Some groups (amber) aren’t a valid terc or row yet.',
    err_needOpening: 'To touch the table you need a terc or row made only of your own cards.',
    err_nothingPlaced: 'Play at least one card, or draw.',
    err_missingCard: 'Cards on the table can’t go back to your hand.',
    err_mustPlay: 'You can play! The pulsing cards are part of a legal play — no drawing.',
    err_notYourTurn: 'It’s not your turn.',
    err_noRoom: 'No such room.', err_roomFull: 'That room is full.', err_server: 'Something went wrong.',
    err_unknownCard: 'Out of sync — resetting your turn.', err_shape: 'Out of sync — resetting your turn.', err_dupCard: 'Out of sync — resetting your turn.',
    logStart: '{n} starts', logPlayed: '{n} played {c} card(s)', logDrew: '{n} drew a card', logWon: '{n} ran out of cards',
  },
  hu: {
    subtitle: 'Kétszemélyes römi, 5 lappal',
    yourName: 'Neved', create: 'Szoba létrehozása', or: 'vagy csatlakozz', join: 'Csatlakozás',
    strict: 'Kötelező lerakás (nem húzhatsz, ha tudsz lerakni)',
    waitTitle: 'Várakozás az ellenfélre…', waitHelp: 'Küldd el neki ezt a linket, vagy a szobakódot:',
    copy: 'Másolás', copied: 'Másolva!', leave: 'Kilépés', reconnecting: 'Újracsatlakozás…',
    done: 'Kész ✔', draw: 'Húzás', reset: 'Kör visszaállítása', sortSuit: 'Rendezés: szín', sortRank: 'Rendezés: szám',
    rematch: 'Újra', viewTable: 'Asztal megtekintése', waitingFor: 'Várakozás: {n}…',
    youWon: 'Nyertél! 🎉', someoneWon: '{n} nyert', winSub: 'Elsőként fogyott el a lapja.',
    terc: 'terc', row: 'sor', opened: 'kinyitott', cards: 'lap', deck: 'pakli',
    yourTurn: 'Te jössz', turnOf: '{n} jön', theirDraft: '{n} rendezgeti az asztalt…',
    hintOpen: 'Előbb rakj le egy tercet vagy sort csak a saját lapjaidból — utána az egész asztal a tiéd. Vagy húzz.',
    hintPlay: 'Húzd a lapokat az asztalra (vagy koppints egy lapra, majd egy mezőre). Rakj le valamit, vagy húzz.',
    okDone: 'Minden rendben — nyomd meg a Kész gombot.',
    err_invalidMeld: 'Néhány csoport (narancs) még nem érvényes terc vagy sor.',
    err_needOpening: 'Az asztalhoz nyúláshoz előbb tercet vagy sort kell lerakni csak a saját lapjaidból.',
    err_nothingPlaced: 'Rakj le legalább egy lapot, vagy húzz.',
    err_missingCard: 'Az asztalon lévő lap nem mehet vissza a kezedbe.',
    err_mustPlay: 'Tudsz lerakni! A pulzáló lapok egy szabályos lerakás részei — nem húzhatsz.',
    err_notYourTurn: 'Nem te jössz.',
    err_noRoom: 'Nincs ilyen szoba.', err_roomFull: 'A szoba megtelt.', err_server: 'Hiba történt.',
    err_unknownCard: 'Szinkronhiba — a kör visszaáll.', err_shape: 'Szinkronhiba — a kör visszaáll.', err_dupCard: 'Szinkronhiba — a kör visszaáll.',
    logStart: '{n} kezd', logPlayed: '{n} lerakott {c} lapot', logDrew: '{n} húzott egy lapot', logWon: '{n}-nek elfogyott a lapja',
  },
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let lang = store.get('lang') || ((navigator.language || '').toLowerCase().startsWith('hu') ? 'hu' : 'en');
const t = (k, vars = {}) =>
  (STR[lang][k] ?? STR.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const S = {
  ws: null,
  connected: false,
  session: null, // { code, token, idx }
  srv: null,
  draft: null, // my working copy of the table during my turn
  draftTurn: null,
  sel: new Set(),
  sort: store.get('sort') || 'suit',
  flash: null, // { text, cls, until }
  hint: new Set(),
  overlayHidden: false,
};
try { S.session = JSON.parse(store.get('session') || 'null'); } catch { S.session = null; }

const clone = (tb) => tb.map((c) => c.slice());
const myTurn = () => !!S.srv && S.srv.phase === 'playing' && S.srv.turn === S.srv.you && !!S.draft;
const oldIds = () => new Set(S.srv.table.flat());
const me = () => S.srv.players[S.srv.you];
const opp = () => S.srv.players[1 - S.srv.you];

function placedIds() {
  const old = oldIds();
  return S.draft.flat().filter((id) => !old.has(id));
}

// Has the player earned the right to touch the table (this turn)?
function unlocked() {
  if (me().opened) return true;
  const old = oldIds();
  return S.draft.some((c) => c.length && c.every((id) => !old.has(id)) && analyzeMeld(c).valid);
}

// ---------------------------------------------------------------------------
// networking
// ---------------------------------------------------------------------------
function send(msg) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(msg));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => {
    S.connected = true;
    if (S.session) send({ t: 'rejoin', code: S.session.code, token: S.session.token });
    renderChrome();
  };
  ws.onmessage = (e) => {
    try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.connected = false;
    renderChrome();
    setTimeout(connect, 1500);
  };
}

function handle(m) {
  switch (m.t) {
    case 'joined':
      S.session = { code: m.code, token: m.token, idx: m.idx };
      store.set('session', JSON.stringify(S.session));
      break;
    case 'state':
      applyState(m.s);
      break;
    case 'rejected':
      if (m.code === 'mustPlay') {
        S.hint = new Set(m.hint || []);
        setTimeout(() => { S.hint = new Set(); render(); }, 7000);
      }
      if (['unknownCard', 'shape', 'dupCard', 'missingCard'].includes(m.code) && S.srv) {
        if (m.code !== 'missingCard') resetDraft();
      }
      flash(t('err_' + m.code), 'bad', 6000);
      render();
      break;
    case 'error':
      if (m.fatal) {
        S.session = null;
        S.srv = null;
        store.del('session');
      }
      $('#lobbyErr').textContent = t('err_' + m.code);
      showScreen();
      break;
  }
}

function applyState(s) {
  const prev = S.srv;
  S.srv = s;
  S.session = { ...S.session, idx: s.you };
  const playing = s.phase === 'playing';
  const mine = playing && s.turn === s.you;
  if (mine) {
    if (S.draftTurn !== s.turnNo || !S.draft) {
      S.draft = clone(s.table);
      S.draftTurn = s.turnNo;
      S.sel.clear();
      S.hint = new Set();
    }
  } else {
    S.draft = null;
    S.draftTurn = null;
    S.sel.clear();
  }
  if (prev && prev.phase === 'over' && s.phase === 'playing') S.overlayHidden = false;
  if (s.phase === 'over' && (!prev || prev.phase !== 'over')) S.overlayHidden = false;
  showScreen();
  render();
}

let draftTimer = null;
function sendDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (myTurn()) send({ t: 'draft', table: S.draft });
  }, 120);
}

function flash(text, cls = 'warn', ms = 4000) {
  S.flash = { text, cls, until: Date.now() + ms };
  setTimeout(render, ms + 20);
}

// ---------------------------------------------------------------------------
// moving cards around (all local until "Done")
// ---------------------------------------------------------------------------
function resetDraft() {
  if (!S.srv || !S.draft) return;
  S.draft = clone(S.srv.table);
  S.sel.clear();
  sendDraft();
}

function moveCards(ids, dest) {
  if (!myTurn() || !ids.length) return;
  const old = oldIds();
  const un = unlocked();
  if (ids.some((id) => old.has(id)) && !un) return flash(t('err_needOpening'), 'warn');
  if (dest === 'hand') {
    if (ids.some((id) => old.has(id))) return flash(t('err_missingCard'), 'warn');
  } else if (S.draft[dest].some((id) => old.has(id)) && !un) {
    return flash(t('err_needOpening'), 'warn');
  }
  const moving = new Set(ids);
  S.draft = S.draft.map((c) => c.filter((id) => !moving.has(id)));
  if (dest !== 'hand') S.draft[dest] = [...S.draft[dest], ...ids];
  S.sel.clear();
  S.hint = new Set();
  S.flash = null;
  sendDraft();
  render();
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function showScreen() {
  const phase = S.srv ? S.srv.phase : null;
  $('#screen-lobby').classList.toggle('hidden', !!S.srv);
  $('#screen-wait').classList.toggle('hidden', !(S.srv && phase === 'lobby'));
  $('#screen-game').classList.toggle('hidden', !(S.srv && phase !== 'lobby'));
  document.body.classList.toggle('ingame', !!S.srv && phase !== 'lobby');
  if (S.srv && phase === 'lobby') {
    $('#waitCode').textContent = S.srv.code;
    $('#shareLink').value = `${location.origin}/?room=${S.srv.code}`;
  }
}

function renderChrome() {
  $('#conn').classList.toggle('hidden', S.connected);
  $('#langBtn').textContent = $('#langBtn2').textContent = lang === 'en' ? 'HU' : 'EN';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $('#sortBtn').textContent = t(S.sort === 'suit' ? 'sortSuit' : 'sortRank');
}

const isRed = (suit) => suit === 1 || suit === 2;

function cardHTML(id, { as = null, extra = '', i = null } = {}) {
  const c = cardInfo(id);
  const style = i === null ? '' : ` style="--i:${i}"`;
  if (c.joker) {
    const lab = as ? `<small class="${isRed(as.suit) ? 'red' : ''}">=${RANK_LABELS[as.rank - 1]}${SUITS[as.suit]}</small>` : '';
    return `<div class="card joker ${extra}" data-id="${id}"${style}><b>JK</b>${lab}</div>`;
  }
  return `<div class="card ${isRed(c.suit) ? 'red' : ''} ${extra}" data-id="${id}" data-s="${SUITS[c.suit]}"${style}><b>${RANK_LABELS[c.rank - 1]}</b></div>`;
}

const sortKey = {
  suit: (id) => { const c = cardInfo(id); return c.joker ? 9999 : c.suit * 100 + c.rank; },
  rank: (id) => { const c = cardInfo(id); return c.joker ? 9999 : c.rank * 10 + c.suit; },
};

function render() {
  if (!S.srv) { renderChrome(); return; }
  renderChrome();
  if (S.srv.phase === 'lobby') return;
  const s = S.srv;
  const mine = myTurn();
  const old = new Set(s.table.flat());

  // header / score
  $('#roomCode').textContent = s.code;
  const [a, b] = s.players;
  $('#score').innerHTML = b ? `${esc(a.name)} <b>${a.wins}</b> – <b>${b.wins}</b> ${esc(b.name)}` : '';

  // opponent bar
  const o = opp();
  $('#opp').classList.toggle('turn', s.phase === 'playing' && !mine);
  $('#oppName').textContent = o.name;
  $('#oppDot').classList.toggle('on', o.connected);
  $('#oppOpened').textContent = o.opened ? t('opened') : '';
  $('#oppOpened').classList.toggle('hidden', !o.opened);
  const shown = Math.min(o.handCount, 14);
  $('#oppCards').innerHTML =
    '<div class="back"></div>'.repeat(shown) +
    (o.handCount > shown ? `<span class="more">+${o.handCount - shown}</span>` : '') +
    (o.handCount ? '' : '');
  const last = s.log[s.log.length - 1];
  const nameOf = (i) => s.players[i]?.name ?? '';
  const logText = !last ? '' : t({ start: 'logStart', played: 'logPlayed', drew: 'logDrew', won: 'logWon' }[last.k], { n: nameOf(last.p), c: last.n });
  $('#oppInfo').textContent = `${o.handCount} ${t('cards')} · ${t('deck')} ${s.deckCount}${logText ? ' · ' + logText : ''}`;

  // board
  const table = mine ? S.draft : s.draft ?? s.table;
  const board = $('#board');
  board.style.setProperty('--cols', s.cols);
  board.classList.toggle('readonly', !mine);
  const un = mine ? unlocked() : true;
  const fresh = new Set(s.fresh); // glow on whatever was laid down last, so you can see what changed
  let html = '';
  for (let i = 0; i < table.length; i++) {
    const ids = table[i];
    let inner = '';
    let cls = 'cell';
    let tag = '';
    if (ids.length) {
      cls += ' has';
      const an = analyzeMeld(ids);
      let slots;
      if (an.valid) {
        cls += ' valid';
        tag = t(an.kind === 'terc' ? 'terc' : 'row');
        slots = an.slots;
      } else {
        cls += ' invalid';
        slots = ids.slice().sort((x, y) => sortKey.suit(x) - sortKey.suit(y)).map((id) => ({ id, as: null }));
      }
      const locked = mine && !un && ids.some((id) => old.has(id));
      if (locked) cls += ' locked';
      inner = `<div class="fan" style="--n:${slots.length}">` + slots.map((sl, k) => cardHTML(sl.id, {
        as: sl.as, i: k,
        extra: [S.sel.has(sl.id) ? 'sel' : '', fresh.has(sl.id) ? 'fresh' : '', locked ? 'lockedcard' : ''].join(' '),
      })).join('') + '</div>';
    }
    html += `<div class="${cls}" data-drop="cell" data-cell="${i}"><span class="num">${i + 1}</span>${tag ? `<span class="tag">${tag}</span>` : ''}${inner}</div>`;
  }
  board.innerHTML = html;
  layoutFans();

  // hand
  const placed = new Set(mine ? placedIds() : []);
  const hand = s.hand.filter((id) => !placed.has(id)).sort((x, y) => sortKey[S.sort](x) - sortKey[S.sort](y));
  $('#hand').innerHTML = hand.map((id) => cardHTML(id, { extra: `${S.sel.has(id) ? 'sel' : ''} ${S.hint.has(id) ? 'hint' : ''}` })).join('');

  // status + buttons
  renderStatus(mine, placed.size);
  renderOverlay();
}

function renderStatus(mine, placedCount) {
  const s = S.srv;
  const st = $('#status');
  let text = '';
  let cls = '';
  let canDone = false;
  if (s.phase === 'over') {
    text = s.winner === s.you ? t('youWon') : t('someoneWon', { n: s.players[s.winner].name });
    cls = 'turn';
  } else if (!mine) {
    text = s.draft ? t('theirDraft', { n: opp().name }) : t('turnOf', { n: opp().name });
    cls = '';
  } else {
    const chk = checkTurn({ oldTable: s.table, hand: s.hand, proposed: S.draft, opened: me().opened });
    if (chk.ok) { text = t('okDone'); cls = 'ok'; canDone = true; }
    else if (chk.code === 'nothingPlaced') { text = t(me().opened || unlocked() ? 'hintPlay' : 'hintOpen'); cls = 'turn'; }
    else { text = t('err_' + chk.code); cls = 'warn'; }
  }
  if (S.flash && S.flash.until > Date.now()) { text = S.flash.text; cls = S.flash.cls; }
  st.textContent = text;
  st.className = 'status ' + cls;

  $('#doneBtn').disabled = !(mine && canDone);
  $('#drawBtn').disabled = !(mine && placedCount === 0);
  const changed = mine && JSON.stringify(S.draft) !== JSON.stringify(s.table);
  $('#resetBtn').disabled = !changed;
}

function renderOverlay() {
  const s = S.srv;
  const show = s.phase === 'over' && !S.overlayHidden;
  $('#overlay').classList.toggle('hidden', !show);
  if (!show) return;
  const won = s.winner === s.you;
  $('#overlayTitle').textContent = won ? t('youWon') : t('someoneWon', { n: s.players[s.winner].name });
  $('#overlaySub').textContent = t('winSub');
  const iVoted = s.rematch[s.you];
  const theyVoted = s.rematch[1 - s.you];
  $('#rematchBtn').disabled = iVoted;
  $('#rematchBtn').textContent = iVoted && !theyVoted ? t('waitingFor', { n: opp().name }) : t('rematch');
}

// Fan out the cards of each cell so long melds squeeze to fit.
function layoutFans() {
  const cw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cw')) || 36;
  document.querySelectorAll('#board .fan').forEach((fan) => {
    const n = Number(fan.style.getPropertyValue('--n')) || 1;
    const avail = fan.parentElement.clientWidth - 12 - cw;
    const full = cw * 0.78;
    const step = n > 1 ? Math.max(9, Math.min(full, avail / (n - 1))) : 0;
    fan.style.setProperty('--step', step + 'px');
    fan.style.setProperty('--stepfull', full + 'px');
    fan.parentElement.classList.toggle('squeezed', step < full - 0.5);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// input: click to select, drag to move (pointer events → works with touch too)
// ---------------------------------------------------------------------------
let drag = null;

function cardLockedNow(id) {
  return !me().opened && !unlocked() && oldIds().has(id);
}

document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.card[data-id]');
  if (!el || !el.closest('#board, #hand') || !S.srv) return;
  if (!myTurn() || e.button > 0) return;
  drag = { id: Number(el.dataset.id), x0: e.clientX, y0: e.clientY, started: false, ghost: null, ids: [] };
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return;
    if (cardLockedNow(drag.id)) { drag = null; flash(t('err_needOpening'), 'warn'); render(); return; }
    drag.started = true;
    drag.ids = S.sel.has(drag.id) ? [...S.sel] : [drag.id];
    drag.ids.forEach((id) => document.querySelectorAll(`.card[data-id="${id}"]`).forEach((c) => c.classList.add('dragging')));
    const g = document.querySelector(`.card[data-id="${drag.id}"]`).cloneNode(true);
    g.classList.remove('dragging', 'sel');
    g.classList.add('ghost-card');
    g.style.removeProperty('--i');
    const cs = getComputedStyle(document.querySelector(`.card[data-id="${drag.id}"]`));
    g.style.setProperty('--cw', cs.width);
    g.style.setProperty('--ch', cs.height);
    if (drag.ids.length > 1) g.insertAdjacentHTML('beforeend', `<span class="count">${drag.ids.length}</span>`);
    document.body.appendChild(g);
    drag.ghost = g;
  }
  drag.ghost.style.left = e.clientX + 'px';
  drag.ghost.style.top = e.clientY + 'px';
  document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
  const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
  if (tgt) tgt.classList.add('over');
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
  if (!d.started) {
    if (!cancelled) toggleSelect(d.id);
    return;
  }
  d.ghost?.remove();
  document.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
  if (cancelled) return;
  const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
  if (!tgt) return render();
  moveCards(d.ids, tgt.dataset.drop === 'hand' ? 'hand' : Number(tgt.dataset.cell));
}
document.addEventListener('pointerup', (e) => endDrag(e, false));
document.addEventListener('pointercancel', (e) => endDrag(e, true));

function toggleSelect(id) {
  if (cardLockedNow(id)) { flash(t('err_needOpening'), 'warn'); render(); return; }
  if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  render();
}

// tap a slot / the hand tray while cards are selected → move them there
document.addEventListener('click', (e) => {
  if (!myTurn() || S.sel.size === 0) return;
  if (e.target.closest('.card') || e.target.closest('button')) return;
  const tgt = e.target.closest('[data-drop]');
  if (!tgt) return;
  moveCards([...S.sel], tgt.dataset.drop === 'hand' ? 'hand' : Number(tgt.dataset.cell));
});

// ---------------------------------------------------------------------------
// buttons
// ---------------------------------------------------------------------------
$('#doneBtn').onclick = () => { if (myTurn()) send({ t: 'done', table: S.draft }); };
$('#drawBtn').onclick = () => { if (myTurn()) { resetDraft(); send({ t: 'draw' }); } };
$('#resetBtn').onclick = () => { resetDraft(); render(); };
$('#sortBtn').onclick = () => { S.sort = S.sort === 'suit' ? 'rank' : 'suit'; store.set('sort', S.sort); render(); };
$('#rematchBtn').onclick = () => send({ t: 'rematch' });
$('#overlayCloseBtn').onclick = () => { S.overlayHidden = true; render(); };
$('#langBtn').onclick = $('#langBtn2').onclick = () => { lang = lang === 'en' ? 'hu' : 'en'; store.set('lang', lang); render(); };
function leave() {
  store.del('session');
  S.session = null;
  S.srv = null;
  S.draft = null;
  history.replaceState(null, '', '/');
  try { S.ws.close(); } catch { /* ignore */ }
  showScreen();
  renderChrome();
}
$('#leaveBtn').onclick = leave;
$('#leaveWaitBtn').onclick = leave;
$('#copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText($('#shareLink').value); } catch { $('#shareLink').select(); document.execCommand?.('copy'); }
  $('#copyBtn').textContent = t('copied');
  setTimeout(() => ($('#copyBtn').textContent = t('copy')), 1500);
};

const nameInput = $('#nameInput');
nameInput.value = store.get('name') || '';
const getName = () => { const n = nameInput.value.trim(); store.set('name', n); return n; };
$('#createBtn').onclick = () => { $('#lobbyErr').textContent = ''; send({ t: 'create', name: getName(), strict: $('#strictInput').checked }); };
$('#joinBtn').onclick = () => { $('#lobbyErr').textContent = ''; send({ t: 'join', code: $('#codeInput').value, name: getName() }); };
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#codeInput').value = urlRoom.toUpperCase().slice(0, 4);

window.addEventListener('resize', layoutFans);

renderChrome();
showScreen();
connect();

// exposed for the e2e test only
window.__otlapos = { get state() { return S; } };
