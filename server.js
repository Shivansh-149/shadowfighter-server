// Shadow Fighter server - zero dependencies (pure Node.js). Works in Termux and on Render.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const WIN_COINS = parseInt(process.env.WIN_COINS || '50', 10);
const LOSE_COINS = parseInt(process.env.LOSE_COINS || '10', 10);
const START_COINS = parseInt(process.env.START_COINS || '100', 10);

// ---------------- storage ----------------
let db = { players: {}, adminKey: null };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) { /* first run */ }
if (process.env.ADMIN_KEY) db.adminKey = process.env.ADMIN_KEY;
if (!db.adminKey) { db.adminKey = crypto.randomBytes(6).toString('hex'); console.log('Generated admin key:', db.adminKey); }
let dirty = true;
function save() { dirty = true; }
setInterval(() => {
  if (!dirty) return; dirty = false;
  try { fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); }
  catch (e) { console.error('save failed', e.message); }
}, 2000);

function newId() { let id; do { id = String(100000 + crypto.randomInt(900000)); } while (db.players[id]); return id; }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function auth(id, token) { const p = db.players[String(id)]; return p && safeEq(p.token, token || '') ? p : null; }
function pub(p) { return { id: p.id, name: p.name, coins: p.coins, wins: p.wins, losses: p.losses }; }
function num(v, d, lo, hi) { v = Number(v); if (!isFinite(v)) return d; return Math.max(lo, Math.min(hi, v)); }

// ---------------- matchmaking ----------------
const queue = new Map();      // id -> {ch, seen}
const inMatch = new Map();    // id -> match
const matches = new Map();
const INTRO_MS = 1400, ROUND_END_MS = 2200, ROUND_SEC = 60, STALE_MS = 8000;

function tryPair() {
  const ids = [...queue.keys()];
  while (ids.length >= 2) {
    const a = ids.shift(), b = ids.shift();
    const m = {
      id: crypto.randomBytes(4).toString('hex'), players: [a, b], ch: [queue.get(a).ch, queue.get(b).ch],
      round: 1, wins: [0, 0], phase: 'intro', pt: Date.now(), hp: [1, 1], mhp: [100, 100],
      st: [null, null], ev: [[], []], seen: [Date.now(), Date.now()], winner: -1, result: null, doneAt: 0, got: [false, false]
    };
    queue.delete(a); queue.delete(b);
    matches.set(m.id, m); inMatch.set(a, m); inMatch.set(b, m);
  }
}

function finish(m, w, forfeit) {
  m.phase = 'done'; m.doneAt = Date.now(); m.winner = w;
  m.result = [0, 0];
  for (let i = 0; i < 2; i++) {
    const p = db.players[m.players[i]]; if (!p) continue;
    const won = (i === w);
    const gain = won ? WIN_COINS : (forfeit === i ? 0 : LOSE_COINS);
    p.coins += gain; if (won) p.wins++; else p.losses++;
    m.result[i] = gain;
  }
  save();
}

function tickMatch(m, now) {
  if (m.phase === 'done') return;
  // disconnect = forfeit
  for (let i = 0; i < 2; i++) if (now - m.seen[i] > STALE_MS) { finish(m, 1 - i, i); return; }
  if (m.phase === 'intro') {
    if (now - m.pt >= INTRO_MS) { m.phase = 'fight'; m.pt = now; }
  } else if (m.phase === 'fight') {
    const left = ROUND_SEC - (now - m.pt) / 1000;
    const dead0 = m.hp[0] <= 0, dead1 = m.hp[1] <= 0;
    if (dead0 || dead1 || left <= 0) {
      let w = -1;
      if (dead0 && dead1) w = -1; else if (dead0) w = 1; else if (dead1) w = 0;
      else { const r0 = m.hp[0] / m.mhp[0], r1 = m.hp[1] / m.mhp[1]; w = r0 > r1 ? 0 : r1 > r0 ? 1 : -1; }
      if (w >= 0) m.wins[w]++;
      m.lastWinner = w; m.phase = 'roundend'; m.pt = now;
    }
  } else if (m.phase === 'roundend') {
    if (now - m.pt >= ROUND_END_MS) {
      if (m.wins[0] >= 2 || m.wins[1] >= 2) finish(m, m.wins[0] >= 2 ? 0 : 1, -1);
      else { m.round++; m.phase = 'intro'; m.pt = now; m.hp = [m.mhp[0], m.mhp[1]]; m.st = [null, null]; m.ev = [[], []]; }
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, q] of queue) if (now - q.seen > STALE_MS) queue.delete(id);
  for (const [mid, m] of matches) {
    tickMatch(m, now);
    if (m.phase === 'done' && (now - m.doneAt > 20000 || (m.got[0] && m.got[1]))) {
      for (const id of m.players) if (inMatch.get(id) === m) inMatch.delete(id);
      matches.delete(mid);
    }
  }
}, 100);

function sanitizeState(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    x: num(s.x, 0, -100, 1000), y: num(s.y, 385, -600, 600), vx: num(s.vx, 0, -2000, 2000), vy: num(s.vy, 0, -2000, 2000),
    f: s.f < 0 ? -1 : 1, st: Math.round(num(s.st, 0, 0, 10)), stT: num(s.stT, 0, 0, 5), hp: num(s.hp, 100, 0, 500), mhp: num(s.mhp, 100, 1, 500),
    en: num(s.en, 0, 0, 100), sh: num(s.sh, 0, 0, 20), cr: s.cr ? 1 : 0, bl: s.bl ? 1 : 0, bt: num(s.bt, 0, 0, 10),
    g: s.g ? 1 : 0, iv: s.iv ? 1 : 0, cb: Math.round(num(s.cb, 0, 0, 99))
  };
}
function sanitizeEvents(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const e of list.slice(0, 8)) {
    if (!e || typeof e !== 'object') continue;
    if (e.t === 'hit') out.push({ t: 'hit', dmg: num(e.dmg, 0, 0, 80), kb: num(e.kb, 0, 0, 600), lc: num(e.lc, 0, -900, 0), d: e.d < 0 ? -1 : 1, crit: e.crit ? 1 : 0, blk: e.blk ? 1 : 0 });
    else if (e.t === 'pb') out.push({ t: 'pb', d: e.d < 0 ? -1 : 1 });
    else if (e.t === 'proj') out.push({ t: 'proj', x: num(e.x, 0, -100, 1000), y: num(e.y, 300, 0, 500), vx: num(e.vx, 0, -900, 900) });
  }
  return out;
}

function handleSync(p, body) {
  const now = Date.now();
  const id = p.id;
  const m = inMatch.get(id);
  if (!m) {
    const q = queue.get(id);
    if (q) { q.seen = now; return { ok: true, status: 'waiting', coins: p.coins, queued: queue.size }; }
    return { ok: true, status: 'idle', coins: p.coins };
  }
  const side = m.players[0] === id ? 0 : 1;
  m.seen[side] = now;
  if (m.phase !== 'done') {
    const rd = Math.round(num(body.rd, 0, 0, 99));
    const s = sanitizeState(body.s);
    if (s && rd === m.round) {
      m.st[side] = s; m.mhp[side] = s.mhp;
      if (m.phase === 'fight') m.hp[side] = s.hp;
    }
    if (m.phase === 'fight' && rd === m.round) {
      const ev = sanitizeEvents(body.ev);
      if (ev.length) { m.ev[1 - side].push(...ev); if (m.ev[1 - side].length > 40) m.ev[1 - side].splice(0, m.ev[1 - side].length - 40); }
    }
    tickMatch(m, now);
  }
  const opp = db.players[m.players[1 - side]];
  const out = {
    side, round: m.round, phase: m.phase, w: [m.wins[side], m.wins[1 - side]],
    opp: { id: opp ? opp.id : '?', name: opp ? opp.name : '?', ch: m.ch[1 - side] },
    os: m.st[1 - side], ev: m.ev[side].splice(0), winner: m.phase === 'roundend' ? (m.lastWinner < 0 ? -1 : (m.lastWinner === side ? 1 : 0)) : -1
  };
  if (m.phase === 'fight') out.t = Math.max(0, ROUND_SEC - (now - m.pt) / 1000);
  else out.t = (now - m.pt) / 1000;
  if (m.phase === 'done') { out.win = m.winner === side; out.gain = m.result ? m.result[side] : 0; m.got[side] = true; }
  return { ok: true, status: 'match', coins: p.coins, m: out };
}

// ---------------- http ----------------
function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function cleanName(n) { return String(n || 'Fighter').replace(/[^\w \-]/g, '').trim().slice(0, 14) || 'Fighter'; }

const lastSeen = new Map();
function adminDetail(dp) {
  const now = Date.now();
  const status = inMatch.has(dp.id) ? 'in match' : queue.has(dp.id) ? 'searching' : (now - (lastSeen.get(dp.id) || 0) < 90000 ? 'online' : 'offline');
  return { id: dp.id, name: dp.name, coins: dp.coins, wins: dp.wins, losses: dp.losses, created: dp.created || 0,
           gemsPending: dp.gemsPending || 0, gemsSent: dp.gemsSent || 0, status, lastSeen: lastSeen.get(dp.id) || 0 };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = req.method + ' ' + url.pathname;
  try {
    if (route === 'GET /' || route === 'GET /api/health')
      return send(res, 200, { ok: true, game: 'Shadow Fighter', players: Object.keys(db.players).length, queue: queue.size, matches: matches.size });

    // ---- admin web page (open in a browser: http://<server>:PORT/admin) ----
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      const html = fs.readFileSync(path.join(__dirname, 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    // ---- admin API ----
    if (url.pathname.startsWith('/admin/')) {
      if (!safeEq(req.headers['x-admin-key'] || '', db.adminKey)) return send(res, 401, { ok: false, error: 'bad admin key' });
      if (route === 'GET /admin/players')
        return send(res, 200, { ok: true, players: Object.values(db.players).map(pub).sort((a, b) => b.coins - a.coins).slice(0, 100) });
      let m = url.pathname.match(/^\/admin\/player\/(\d+)$/);
      if (m && req.method === 'GET') {
        const p = db.players[m[1]]; if (!p) return send(res, 404, { ok: false, error: 'no such player id' });
        return send(res, 200, { ok: true, player: pub(p) });
      }
      const dm = url.pathname.match(/^\/admin\/detail\/(\d+)$/);
      if (dm && req.method === 'GET') {
        const dp = db.players[dm[1]]; if (!dp) return send(res, 404, { ok: false, error: 'no such player id' });
        return send(res, 200, { ok: true, player: adminDetail(dp) });
      }
      if (route === 'POST /admin/gems') {
        const gb = await readBody(req); const gp = db.players[String(gb.id)];
        if (!gp) return send(res, 404, { ok: false, error: 'no such player id' });
        const amt = Math.trunc(Number(gb.amount));
        if (!isFinite(amt) || amt < 1 || amt > 1000000) return send(res, 400, { ok: false, error: 'bad amount (1 - 1000000)' });
        gp.gemsPending = (gp.gemsPending || 0) + amt; gp.gemsSent = (gp.gemsSent || 0) + amt;
        save(); console.log('[admin] gems', gp.id, '+' + amt);
        return send(res, 200, { ok: true, player: adminDetail(gp) });
      }
      if (route === 'POST /admin/coins') {
        const b = await readBody(req); const p = db.players[String(b.id)];
        if (!p) return send(res, 404, { ok: false, error: 'no such player id' });
        const amt = Math.trunc(Number(b.amount));
        if (!isFinite(amt) || Math.abs(amt) > 1e9) return send(res, 400, { ok: false, error: 'bad amount' });
        p.coins = b.mode === 'set' ? Math.max(0, amt) : Math.max(0, p.coins + amt);
        save(); console.log('[admin] coins', p.id, b.mode || 'add', amt, '->', p.coins);
        return send(res, 200, { ok: true, player: pub(p) });
      }
      return send(res, 404, { ok: false, error: 'not found' });
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not found' });
    const b = await readBody(req);

    if (url.pathname === '/api/register') {
      const id = newId();
      const p = { id, token: crypto.randomBytes(16).toString('hex'), name: cleanName(b.name), coins: START_COINS, wins: 0, losses: 0, created: Date.now() };
      db.players[id] = p; save();
      return send(res, 200, { ok: true, token: p.token, ...pub(p) });
    }
    const p = auth(b.id, b.token);
    if (!p) return send(res, 401, { ok: false, error: 'unknown player' });

    lastSeen.set(p.id, Date.now());
    switch (url.pathname) {
      case '/api/friends': {
        const ids = Array.isArray(b.ids) ? b.ids.slice(0, 50) : [];
        const now = Date.now(); const out = [];
        for (const raw of ids) {
          const fid = String(raw);
          if (!/^\d{1,10}$/.test(fid)) continue;
          const fp = db.players[fid]; if (!fp) continue;
          const st = inMatch.has(fid) ? 'match' : queue.has(fid) ? 'queue' : (now - (lastSeen.get(fid) || 0) < 90000 ? 'online' : 'offline');
          out.push({ id: fp.id, name: fp.name, wins: fp.wins, losses: fp.losses, status: st });
        }
        return send(res, 200, { ok: true, friends: out });
      }
      case '/api/claimgems': {
        const g = p.gemsPending || 0;
        if (g > 0) { p.gemsPending = 0; save(); }
        return send(res, 200, { ok: true, gems: g });
      }
      case '/api/me': return send(res, 200, { ok: true, ...pub(p) });
      case '/api/rename': p.name = cleanName(b.name); save(); return send(res, 200, { ok: true, ...pub(p) });
      case '/api/queue':
        if (!inMatch.has(p.id)) { queue.set(p.id, { ch: Math.round(num(b.ch, 0, 0, 2)), seen: Date.now() }); tryPair(); }
        return send(res, 200, { ok: true, status: inMatch.has(p.id) ? 'match' : 'waiting' });
      case '/api/leave': {
        queue.delete(p.id);
        const m = inMatch.get(p.id);
        if (m && m.phase !== 'done') finish(m, m.players[0] === p.id ? 1 : 0, m.players[0] === p.id ? 0 : 1);
        return send(res, 200, { ok: true });
      }
      case '/api/sync': return send(res, 200, handleSync(p, b));
    }
    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error(e); return send(res, 500, { ok: false, error: 'server error' });
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Shadow Fighter server on port ' + PORT);
  console.log('Admin key: ' + (process.env.ADMIN_KEY ? '(from ADMIN_KEY env)' : db.adminKey));
  console.log('Admin page: http://127.0.0.1:' + PORT + '/admin');
});
process.on('SIGINT', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });
