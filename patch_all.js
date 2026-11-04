// Adds friends + admin details + send gems to server.js (safe to run twice)
const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
const need = ['const server = http.createServer(', 'switch (url.pathname) {', "case '/api/me':", "if (route === 'POST /admin/coins') {"];
for (const a of need) if (!s.includes(a)) { console.error('Cannot patch: not found -> ' + a); process.exit(1); }
let did = false;

if (!s.includes("'/api/friends'")) {
  s = s.replace('const server = http.createServer(', 'const lastSeen = new Map();\nconst server = http.createServer(');
  s = s.replace('switch (url.pathname) {', 'lastSeen.set(p.id, Date.now());\n    switch (url.pathname) {');
  s = s.replace("case '/api/me':", `case '/api/friends': {
        const ids = Array.isArray(b.ids) ? b.ids.slice(0, 50) : [];
        const now = Date.now(); const out = [];
        for (const raw of ids) {
          const fid = String(raw);
          if (!/^\\d{1,10}$/.test(fid)) continue;
          const fp = db.players[fid]; if (!fp) continue;
          const st = inMatch.has(fid) ? 'match' : queue.has(fid) ? 'queue' : (now - (lastSeen.get(fid) || 0) < 90000 ? 'online' : 'offline');
          out.push({ id: fp.id, name: fp.name, wins: fp.wins, losses: fp.losses, status: st });
        }
        return send(res, 200, { ok: true, friends: out });
      }
      case '/api/me':`);
  did = true; console.log('friends added');
}

if (!s.includes('function adminDetail')) {
  s = s.replace('const server = http.createServer(', `function adminDetail(dp) {
  const now = Date.now();
  const status = inMatch.has(dp.id) ? 'in match' : queue.has(dp.id) ? 'searching' : (now - (lastSeen.get(dp.id) || 0) < 90000 ? 'online' : 'offline');
  return { id: dp.id, name: dp.name, coins: dp.coins, wins: dp.wins, losses: dp.losses, created: dp.created || 0,
           gemsPending: dp.gemsPending || 0, gemsSent: dp.gemsSent || 0, status, lastSeen: lastSeen.get(dp.id) || 0 };
}
const server = http.createServer(`);
  s = s.replace("if (route === 'POST /admin/coins') {", `const dm = url.pathname.match(/^\\/admin\\/detail\\/(\\d+)$/);
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
      if (route === 'POST /admin/coins') {`);
  s = s.replace("case '/api/me':", `case '/api/claimgems': {
        const g = p.gemsPending || 0;
        if (g > 0) { p.gemsPending = 0; save(); }
        return send(res, 200, { ok: true, gems: g });
      }
      case '/api/me':`);
  did = true; console.log('admin details + gems added');
}
if (did) fs.writeFileSync('server.js', s);
console.log(did ? 'server.js patched.' : 'Already patched.');
