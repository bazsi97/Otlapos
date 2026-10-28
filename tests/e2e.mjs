// Optional end-to-end smoke test: two real browsers play a few turns.
//   OTLAPOS_DEBUG=1 PORT=3111 node server/server.js &
//   node tests/e2e.mjs            (needs `playwright` installed globally or locally)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:3111';
const SHOTS = process.env.SHOTS || '.';
const c = (suit, rank, copy = 0) => copy * 52 + suit * 13 + (rank - 1);
const [SP, HE, DI, CL] = [0, 1, 2, 3];

const browser = await chromium.launch();
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errors = [];
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${n} console: ${m.text()}`));
}

const debugSet = (page, payload) =>
  page.evaluate((p) => window.__otlapos.state.ws.send(JSON.stringify({ t: 'debugSet', ...p })), payload);
const waitState = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });

async function dragCard(page, id, cellIdx) {
  const card = page.locator(`.card[data-id="${id}"]`).first();
  const cell = page.locator(`#board .cell[data-cell="${cellIdx}"]`);
  const cb = await card.boundingBox();
  const tb = await cell.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 20, cb.y - 20, { steps: 4 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
}

// ---------- lobby ----------
await A.goto(URL);
await A.fill('#nameInput', 'Bazsi');
await A.click('#createBtn');
await A.waitForSelector('#screen-wait:not(.hidden)');
const code = (await A.textContent('#waitCode')).trim();
assert.match(code, /^[A-Z]{4}$/);

await B.goto(`${URL}/?room=${code}`);
assert.equal(await B.inputValue('#codeInput'), code);
await B.fill('#nameInput', 'Dad');
await B.click('#joinBtn');
await A.waitForSelector('#screen-game:not(.hidden)');
await B.waitForSelector('#screen-game:not(.hidden)');
assert.equal(await A.locator('#board .cell').count(), 49);
assert.equal(await A.locator('#hand .card').count(), 5);
assert.equal(await B.locator('#hand .card').count(), 5);
console.log('lobby + deal OK, room', code);

// ---------- scenario 1: opening with a terc via drag & drop ----------
await debugSet(A, {
  turn: 0,
  opened: [false, false],
  table: Array.from({ length: 49 }, () => []),
  hands: [[c(HE, 7), c(SP, 7), c(DI, 7), c(CL, 5), c(DI, 13)], [c(HE, 2), c(SP, 9), c(DI, 12), c(CL, 1), c(HE, 4)]],
});
await waitState(A, () => window.__otlapos.state.srv.turn === 0 && window.__otlapos.state.srv.hand.length === 5 && window.__otlapos.state.draft);
assert.equal(await A.locator('#doneBtn').isDisabled(), true);
for (const id of [c(HE, 7), c(SP, 7)]) await dragCard(A, id, 0);
assert.equal(await A.locator('#doneBtn').isDisabled(), true, 'two cards are not a meld yet');
await dragCard(A, c(DI, 7), 0);
await A.waitForSelector('#board .cell[data-cell="0"].valid');
assert.equal(await A.locator('#doneBtn').isDisabled(), false);
assert.equal((await A.textContent('#board .cell[data-cell="0"] .tag')).trim(), 'terc');
// opponent sees the live draft
await B.waitForSelector('#board .cell[data-cell="0"].valid');
await A.screenshot({ path: `${SHOTS}/shot-1-terc-ready.png` });
await A.click('#doneBtn');
await waitState(B, () => window.__otlapos.state.srv.turn === 1);
assert.equal(await A.locator('#hand .card').count(), 2);
assert.equal(await B.locator('#board .cell[data-cell="0"] .card').count(), 3);
assert.equal(await B.locator('#board .cell[data-cell="0"] .card.fresh').count(), 3, 'new cards glow for opponent');
console.log('terc via drag OK');

// ---------- scenario 2: forced play – B (opened=false) has no meld, may draw ----------
await B.click('#drawBtn');
await waitState(B, () => window.__otlapos.state.srv.turn === 0 && window.__otlapos.state.srv.hand.length === 6);
assert.equal(await B.locator('#hand .card').count(), 6);
console.log('draw OK');

// ---------- scenario 3: A is opened; tap-select + tap-slot to extend with 7♣ and win ----------
await debugSet(A, { turn: 0, hands: [[c(CL, 7)], null] });
await waitState(A, () => window.__otlapos.state.srv.hand.length === 1 && window.__otlapos.state.draft);
await A.locator(`#hand .card[data-id="${c(CL, 7)}"]`).click();
assert.equal(await A.locator('.card.sel').count(), 1);
await A.locator('#board .cell[data-cell="0"]').click({ position: { x: 5, y: 5 } });
await A.waitForFunction(() => document.querySelectorAll('#board .cell[data-cell="0"] .card').length === 4);
assert.equal(await A.locator('#doneBtn').isDisabled(), false);
await A.click('#doneBtn');
await A.waitForSelector('#overlay:not(.hidden)');
await B.waitForSelector('#overlay:not(.hidden)');
assert.match(await A.textContent('#overlayTitle'), /won/i);
await A.screenshot({ path: `${SHOTS}/shot-2-win.png` });
console.log('extend + win OK');

// ---------- scenario 4: rematch ----------
await A.click('#rematchBtn');
await B.click('#rematchBtn');
await waitState(A, () => window.__otlapos.state.srv.phase === 'playing');
assert.equal(await A.locator('#hand .card').count(), 5);
console.log('rematch OK');

// ---------- scenario 5: strict mode refuses a draw when a play exists; rearranging with a joker ----------
const tbl = Array.from({ length: 49 }, () => []);
tbl[0] = [c(SP, 9), c(SP, 10), 104]; // 9♠ 10♠ JOKER
tbl[1] = [c(HE, 4), c(DI, 4), c(CL, 4)]; // terc of 4s
const turnA = await A.evaluate(() => window.__otlapos.state.srv.turn === window.__otlapos.state.srv.you);
const mover = turnA ? A : B;
await debugSet(mover, {
  turn: turnA ? 0 : 1, opened: [true, true], table: tbl,
  hands: turnA ? [[c(SP, 11), c(CL, 13), c(HE, 1), c(DI, 2), c(CL, 9)], null] : [null, [c(SP, 11), c(CL, 13), c(HE, 1), c(DI, 2), c(CL, 9)]],
});
await waitState(mover, () => window.__otlapos.state.srv.hand.length === 5 && window.__otlapos.state.draft && window.__otlapos.state.srv.table[1].length === 3);
await mover.screenshot({ path: `${SHOTS}/shot-3-joker-table.png` });
await mover.click('#drawBtn');
await mover.waitForSelector('.card.hint');
assert.match(await mover.textContent('#status'), /can play|Tudsz/i);
// now actually do it: J♠ replaces the joker's spot; joker moves into the 4s terc
await dragCard(mover, c(SP, 11), 0);
await dragCard(mover, 104, 1);
await mover.waitForSelector('#board .cell[data-cell="1"].valid');
await mover.waitForSelector('#board .cell[data-cell="0"].valid');
assert.equal(await mover.locator('#doneBtn').isDisabled(), false, 'joker liberation is a legal turn');
await mover.screenshot({ path: `${SHOTS}/shot-4-joker-moved.png` });
await mover.click('#doneBtn');
await waitState(mover, () => window.__otlapos.state.srv.turn !== window.__otlapos.state.srv.you);
console.log('strict draw refusal + joker rearrangement OK');

// ---------- reconnect ----------
await A.reload();
await A.waitForSelector('#screen-game:not(.hidden)');
assert.ok((await A.locator('#hand .card').count()) >= 1);
console.log('reconnect OK');

await browser.close();
assert.deepEqual(errors, [], 'no browser errors');
console.log('ALL E2E OK');
