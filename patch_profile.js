// patch_profile.js - run ONCE in ~/ShadowFighterServer:   node patch_profile.js
// Lets players see each other's AVATAR + BANNER (in the match, friends list, profile).
// Works with or without patch_gems.js. Safe to run twice. Backup: server.js.bak2
const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');
if (s.includes('PROFILE_FIX')) { console.log('already patched - nothing to do'); process.exit(0); }
fs.writeFileSync('server.js.bak2', s);
let done = [];

// 1. avatar + banner in every player reply (register, me, rename ...)
const m = s.match(/function pub\(p\) \{ return \{ /);
if (m) { s = s.replace(m[0], m[0] + 'avatar: (p.avatar | 0), banner: (p.banner | 0), '); done.push('player replies'); }

// 2. opponent look inside a match
const o = "name: opp ? opp.name : '?',";
if (s.includes(o)) { s = s.replace(o, o + " avatar: opp ? (opp.avatar | 0) : 0, banner: opp ? (opp.banner | 0) : 0,"); done.push('match opponent'); }

// 3. friends list
const f = 'name: fp.name, wins: fp.wins';
if (s.includes(f)) { s = s.replace(f, 'name: fp.name, avatar: (fp.avatar | 0), banner: (fp.banner | 0), wins: fp.wins'); done.push('friends list'); }

// 4. /api/profile  (saves the player's choice)
const a = s.indexOf('const p = auth(b.id, b.token);');
const sw = a < 0 ? -1 : s.indexOf('switch (url.pathname) {', a);
if (sw < 0 || sw - a > 800) { console.log('ERROR: could not find the place to patch. Send me server.js'); process.exit(1); }
const at = sw + 'switch (url.pathname) {'.length;
s = s.slice(0, at) + `
      // PROFILE_FIX
      case '/api/profile': {
        p.avatar = Math.max(0, Math.min(7, Math.floor(Number(b.avatar)) || 0));
        p.banner = Math.max(0, Math.min(5, Math.floor(Number(b.banner)) || 0));
        save();
        return send(res, 200, { ok: true, avatar: p.avatar, banner: p.banner });
      }
` + s.slice(at);
done.push('/api/profile');
fs.writeFileSync('server.js', s);
console.log('patched: ' + done.join(', '));
console.log('next:  node --check server.js && git add -A && git commit -m profile && git pull --rebase && git push');
