# Öt lapos römi

Online 5-card rummy for two players. Node + WebSocket, no build step, no database.

```bash
npm install
npm start            # http://localhost:3000  (PORT env var to change)
npm test             # rules engine + game logic
```

One player creates a room and sends the link (or 4-letter code) to the other. Works on desktop,
tablet and phone. English / Hungarian toggle in the corner.

## Rules as implemented

| | |
|---|---|
| Deck | 2 × 52 cards + **6 jokers** (110). Each player starts with **5 cards**. |
| Turn | Either **play** (put at least one card on the table) or **draw one card**. Nothing is ever discarded, and a drawn card ends your turn. |
| **Terc** | 3 or 4 cards of the same number, all different suits. |
| **Row** | 3–13 consecutive cards of one suit. Ace is low (A‑2‑3) *or* high (Q‑K‑A); no wrap-around (K‑A‑2). |
| Jokers | Wild. Every meld needs at least 2 real cards. |
| Forced play | If you *can* play, you *must* – the server refuses a draw and pulses the cards that belong to a legal play. (Room option; off = honour system.) |
| Opening | No 51-point rule, values don't matter. Your first meld must be made **only from your own hand**. |
| After opening | The **whole table is yours**: borrow cards, split/merge rows, pull a joker out and use it elsewhere – as long as when you press **Done** every group on the table is a valid terc or row. Cards on the table never go back to a hand. |
| Winning | First to empty their hand. Rematch alternates who starts. |

Judgement calls where the rules were open (all one-liners in `shared/rules.js` / `server/game.js`
if you play it differently): ace high+low, max 4 in a terc, ≥2 natural cards per meld,
draw ends the turn.

## Using the board

* The 7×7 grid is the table; each slot holds one terc/row. Green outline = valid, amber = not (yet) valid.
* **Drag** cards between your hand and the slots (or between slots), or **tap** cards to select (several at once)
  and then tap a slot. Jokers show what they currently stand for (e.g. `=7♥`).
* **Reset turn** puts everything back as it was when your turn started. **Done** is only enabled when the
  whole table is valid; the server re-checks everything.
* Your opponent watches your arrangement live, and the cards you laid last glow gold for them.

## How "must play" is enforced

`canPlay()` in `shared/rules.js` is an exact solver: can the table cards **plus at least one hand card** be
re-partitioned into valid terces/rows? (Memoised search over the 52 distinct faces; every table card is
mandatory, every hand card optional, jokers fully wild.) If it hits its node budget it answers "unknown" and
lets the draw through rather than blocking a player wrongly.

## Hosting it so your dad can join

It's a single Node process that serves the page and the WebSocket on the same port. Easiest options:

* **Render / Railway / Fly.io**: new web service from this repo, build `npm install`, start `npm start`.
  (Free tiers sleep when idle and keep rooms in memory only, so a restart drops running games.)
* **Right now from your laptop**: `npm start`, then `npx cloudflared tunnel --url http://localhost:3000`
  (or ngrok) and send him the https link.
* Same Wi‑Fi: open `http://<your-laptop-ip>:3000` on his device.

Players are re-attached after a refresh/reconnect via a token in `localStorage`.

## Tests

* `npm test` – unit tests, including a randomized check of the solver.
* `tests/e2e.mjs` – optional Playwright test with two real browsers (drag & drop, joker rearranging,
  forced-play refusal, reconnect). Run the server with `OTLAPOS_DEBUG=1 PORT=3111` first
  (that flag enables a test-only hook for setting up hands; never set it in production).
