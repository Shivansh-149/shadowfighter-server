#!/usr/bin/env node
/* Shadow Fighter admin tool - run in Termux (works with the Render server).

  node admin.js players
  node admin.js info 400916
  node admin.js gift 400916 coins 500        (one player)
  node admin.js gift 400916 gems 20
  node admin.js gift all coins 50            (every player)
  node admin.js gift all gems 5
  node admin.js set 400916 coins 1000        (set coins to an exact number)

  Admin key: put it in a file named admin_key.txt (one line) next to this
  script, or run:  ADMIN_KEY=yourkey node admin.js players
  Another server:  SERVER=https://other.onrender.com node admin.js players
*/
const fs = require('fs'), path = require('path');
const BASE = (process.env.SERVER || 'https://shadowfighter-server.onrender.com').replace(/\/$/, '');
let KEY = process.env.ADMIN_KEY || '';
if (!KEY) { try { KEY = fs.readFileSync(path.join(__dirname, 'admin_key.txt'), 'utf8').trim(); } catch (e) {} }
if (!KEY) { console.log('No admin key. Create admin_key.txt or set ADMIN_KEY.'); process.exit(1); }

async function call(method, p, body) {
  let r;
  try {
    r = await fetch(BASE + p, { method, headers: { 'x-admin-key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(70000) });
  } catch (e) { console.log("Can't reach the server (a sleeping free server takes ~50s). " + e.message); process.exit(1); }
  const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
  if (!j.ok) { console.log('Error: ' + (j.error || 'failed')); process.exit(1); }
  return j;
}

async function giveOne(id, kind, n) {
  if (kind === 'coins') { const j = await call('POST', '/admin/coins', { id, amount: n, mode: 'add' }); return j.player.name + ' now has ' + j.player.coins + ' coins'; }
  if (kind === 'gems')  { const j = await call('POST', '/admin/gems', { id, amount: n }); return j.player.name + ': ' + j.player.gemsPending + ' gems waiting (arrive when the game opens Online)'; }
  console.log('Kind must be coins or gems'); process.exit(1);
}

(async () => {
  const a = process.argv.slice(2);
  if (a[0] === 'players') {
    const ps = (await call('GET', '/admin/players')).players;
    console.log(ps.length + ' players');
    ps.forEach(p => console.log(p.id + '  ' + p.name.padEnd(14) + ' coins ' + p.coins + '  W/L ' + p.wins + '/' + p.losses));
  } else if (a[0] === 'info' && a[1]) {
    console.log((await call('GET', '/admin/detail/' + a[1])).player);
  } else if (a[0] === 'gift' && a.length >= 4) {
    const n = parseInt(a[3], 10);
    if (!isFinite(n) || n < 1) { console.log('Amount must be 1 or more'); process.exit(1); }
    if (a[1] === 'all') {
      const ps = (await call('GET', '/admin/players')).players;
      for (const p of ps) await giveOne(p.id, a[2], n);
      console.log('Sent ' + n + ' ' + a[2] + ' to ' + ps.length + ' player(s)');
    } else console.log(await giveOne(a[1], a[2], n));
  } else if (a[0] === 'set' && a[2] === 'coins' && a[3]) {
    const j = await call('POST', '/admin/coins', { id: a[1], amount: parseInt(a[3], 10), mode: 'set' });
    console.log(j.player.name + ' coins set to ' + j.player.coins);
  } else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('#!/usr/bin/env node\n/*', ''));
})();
