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
| Forced play | You **must play only if your own hand holds a terc or row made of real cards** (no jokers needed). Having a joker that would make a play possible, or being able to add to / rearrange the table, never forces you – you may always draw. The server refuses the draw and pulses the cards. (Room option; off = honour system.) |
| Opening | No 51-point rule, values don't matter. Your first meld must be made **only from your own hand**. |
| After opening | The **whole table is yours**: borrow cards, split/merge rows, pull a joker out and use it elsewhere – as long as when you press **Done** every group on the table is a valid terc or row. Cards on the table never go back to a hand. |
| Winning | First to empty their hand. Rematch alternates who starts. |

Judgement calls where the rules were open (all one-liners in `public/shared/rules.js` / `server/game.js`
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

On a draw, the server looks at your hand with the jokers removed and asks `canPlay()` (in
`public/shared/rules.js`) whether those cards contain a terc or row. If so the draw is refused and those
cards are returned as the hint. `canPlay()` itself is a more general exact solver (it can also re-partition the
whole table, jokers included) – it's currently only used on the hand, but it's there if you ever want a
stricter variant.

## Hosting it so your dad can join

**Cloudflare (recommended).** A Worker serves the page and every room is a Durable Object that holds both
WebSockets and the game state (persisted, so it survives restarts; idle rooms cost nothing). No sleeping, free plan is enough.

```bash
npm install
npx wrangler login      # once
npm run cf:deploy       # -> https://otlapos.<your-subdomain>.workers.dev
```

Or in the dashboard: *Workers & Pages -> Create -> Import a repository*, pick this repo/branch, build command
`npm install`, deploy command `npx wrangler deploy` (config is in `wrangler.jsonc`).
`npm run cf:dev` runs the same thing locally.

**Render** (`render.yaml`, plain Node server, rooms only in memory) or **your laptop**
(`npm start` + `npx cloudflared tunnel --url http://localhost:3000`) also work.

Players are re-attached after a refresh/reconnect via a token in `localStorage`.

## Tests

* `npm test` – unit tests, including a randomized check of the solver.
* `tests/e2e.mjs` – optional Playwright test with two real browsers (drag & drop, joker rearranging,
  forced-play refusal, reconnect). Run the server with `OTLAPOS_DEBUG=1 PORT=3111` first
  (that flag enables a test-only hook for setting up hands; never set it in production).
