// Cloudflare Worker: serves the static game from ./public and routes each WebSocket to the
// Durable Object that owns that room (one object per 4-letter room code).
import { CODE_RE } from '../server/handlers.js';
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok');
    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('room') || '').toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad room', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
