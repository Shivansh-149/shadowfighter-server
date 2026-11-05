// patch_gems.js - run ONCE in ~/ShadowFighterServer:   node patch_gems.js
// Adds everything the game needs for GEMS to work on your Render server:
//   gems in every reply (/api/me, /api/register), spend coins, spend gems, spin-wheel prizes,
//   gifts (coins + gems), restore (gives back what the phone remembers after Render forgets),
//   player stats. Gems that the admin sent ("waiting") are counted automatically.
// Safe to run twice. Makes a backup:  server.js.bak
const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
if (s.includes('GEMS_FIX')) { console.log('already patched - nothing to do'); process.exit(0); }

const a = s.indexOf('const p = auth(b.id, b.token);');
const sw = a < 0 ? -1 : s.indexOf('switch (url.pathname) {', a);
if (sw < 0 || sw - a > 800) { console.log('ERROR: could not find the place to patch (auth + switch). Send me server.js'); process.exit(1); }
const swEnd = sw + 'switch (url.pathname) {'.length;

const helpers = String.raw`// GEMS_FIX helpers
    function gxGems(pl) { if ((pl.gemsPending || 0) > 0) { pl.gems = (pl.gems || 0) + pl.gemsPending; pl.gemsPending = 0; save(); } return pl.gems || 0; }
    function gxBal(pl) { return { coins: pl.coins || 0, gems: gxGems(pl) }; }
    function gxOnline(id) { return inMatch.has(id) || queue.has(id) || (typeof lastSeen !== 'undefined' && Date.now() - (lastSeen.get(id) || 0) < 90000); }
    `;

const cases = String.raw`
      // GEMS_FIX cases
      case '/api/me':
        return send(res, 200, { ok: true, ...pub(p), gems: gxGems(p) });
      case '/api/spend': {
        const amt = Math.floor(Number(b.amount));
        if (!isFinite(amt) || amt < 1 || amt > 100000) return send(res, 400, { ok: false, error: 'bad amount' });
        if ((p.coins || 0) < amt) return send(res, 200, { ok: false, error: 'Not enough coins', ...gxBal(p) });
        p.coins -= amt; save();
        return send(res, 200, { ok: true, ...gxBal(p) });
      }
      case '/api/spendgems': {
        const amt = Math.floor(Number(b.amount));
        if (!isFinite(amt) || amt < 1 || amt > 100) return send(res, 400, { ok: false, error: 'bad amount' });
        if (gxGems(p) < amt) return send(res, 200, { ok: false, error: 'Not enough gems', ...gxBal(p) });
        p.gems -= amt; save();
        return send(res, 200, { ok: true, ...gxBal(p) });
      }
      case '/api/wheelcoins':
      case '/api/wheelgems': {
        const gem = url.pathname === '/api/wheelgems';
        const amt = Math.floor(Number(b.amount));
        if (!(gem ? [1, 2] : [10, 25, 100, 250, 500]).includes(amt)) return send(res, 400, { ok: false, error: 'bad amount' });
        const now = Date.now();
        if (now - (p.lastWheel || 0) < 3000) return send(res, 200, { ok: false, error: 'too fast', ...gxBal(p) });
        p.lastWheel = now;
        if (gem) { gxGems(p); p.gems = (p.gems || 0) + amt; } else p.coins = (p.coins || 0) + amt;
        save();
        return send(res, 200, { ok: true, ...gxBal(p) });
      }
      case '/api/gift': {
        const kind = b.kind === 'gems' ? 'gems' : 'coins';
        const to = db.players[String(b.to || '')];
        const amount = Math.floor(Number(b.amount));
        const max = kind === 'gems' ? 10000 : 1000000;
        if (!to) return send(res, 200, { ok: false, error: 'No player with that ID' });
        if (to.id === p.id) return send(res, 200, { ok: false, error: "You can't gift yourself" });
        if (!(amount >= 1 && amount <= max)) return send(res, 200, { ok: false, error: 'Gift must be 1 to ' + max + ' ' + kind });
        gxGems(p); gxGems(to);
        if ((p[kind] || 0) < amount) return send(res, 200, { ok: false, error: 'Not enough ' + kind + ' (you have ' + (p[kind] || 0) + ')' });
        p[kind] = (p[kind] || 0) - amount;
        to[kind] = (to[kind] || 0) + amount;
        save();
        return send(res, 200, { ok: true, ...gxBal(p) });
      }
      case '/api/restore': {
        // Render forgot this player and the game re-created the SAME id: give back what the phone remembers (once)
        const rc = Math.max(0, Math.min(5000000, Math.floor(Number(b.coins)) || 0));
        const rg = Math.max(0, Math.min(5000, Math.floor(Number(b.gems)) || 0));
        const fresh = !p.restored && ((p.wins || 0) + (p.losses || 0)) === 0 && (Date.now() - (p.created || 0)) < 10 * 60 * 1000;
        if (fresh) {
          gxGems(p);
          p.coins = Math.max(p.coins || 0, rc);
          p.gems = Math.max(p.gems || 0, rg);
          p.restored = true; save();
        }
        return send(res, 200, { ok: true, restored: !!fresh, ...gxBal(p) });
      }
      case '/api/stats': {
        const all = Object.values(db.players);
        return send(res, 200, { ok: true, total: all.length, online: all.filter(x => gxOnline(x.id)).length });
      }
`;

// gems also in register / rename replies (pub)
const pubOld = 'function pub(p) { return { id: p.id, name: p.name, coins: p.coins, wins: p.wins, losses: p.losses }; }';
if (s.includes(pubOld)) s = s.replace(pubOld, 'function pub(p) { return { id: p.id, name: p.name, coins: p.coins, gems: (p.gems || 0) + (p.gemsPending || 0), wins: p.wins, losses: p.losses }; }');

fs.writeFileSync('server.js.bak', fs.readFileSync('server.js'));
const a2 = s.indexOf('const p = auth(b.id, b.token);');
const sw2 = s.indexOf('switch (url.pathname) {', a2), swEnd2 = sw2 + 'switch (url.pathname) {'.length;
s = s.slice(0, swEnd2) + cases + s.slice(swEnd2);
s = s.slice(0, sw2) + helpers + s.slice(sw2);
fs.writeFileSync('server.js', s);
console.log('patched: gems, spend, wheel, gifts, restore, stats');
console.log('next:  node --check server.js && git add -A && git commit -m gems && git pull --rebase && git push');
