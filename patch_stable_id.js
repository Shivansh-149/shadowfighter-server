const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
if (s.includes('STABLE_ID')) { console.log('already patched'); process.exit(0); }
const old = "const id = newId();\n      const p = { id, token: crypto.randomBytes(16).toString('hex'),";
if (!s.includes(old)) { console.log('register block not found'); process.exit(1); }
const neu = `// STABLE_ID
      if (/^\\d{6}$/.test(String(b.id || '')) && /^[0-9a-f]{32}$/.test(String(b.token || ''))) {
        const ex = db.players[String(b.id)];
        if (ex && ex.token === b.token) return send(res, 200, { ok: true, token: ex.token, ...pub(ex) });
        if (!ex) {
          const np = { id: String(b.id), token: b.token, name: cleanName(b.name), coins: START_COINS, wins: 0, losses: 0, created: Date.now() };
          db.players[np.id] = np; save();
          return send(res, 200, { ok: true, token: np.token, ...pub(np) });
        }
      }
      const id = newId();
      const p = { id, token: crypto.randomBytes(16).toString('hex'),`;
fs.writeFileSync('server.js', s.replace(old, neu));
console.log('patched');
