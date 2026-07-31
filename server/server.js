// Backend + static file server for e-Gerak SPR - one process serves both the
// app (index.html, manifest, icons) and the shared /api/movements data, so
// staff on other devices just need one URL, e.g. http://<this-pc's-LAN-IP>:3001
// (find that IP with `ipconfig` on Windows), rather than running two servers.
//
// Uses only Node's built-in http + fs + node:sqlite modules - no npm install needed.
// Run with: node server/server.js  (requires Node 22.5+)
//
// Local/LAN use: binds to all interfaces on port 3001, DB file lives next to this
// script. Make sure Windows Firewall allows inbound connections on this port so
// other devices on the same Wi-Fi/LAN can reach it.
//
// Deployed (e.g. Railway): set the PORT env var (the host usually sets this for you)
// and DB_PATH to a path inside a mounted persistent volume, e.g. /data/movements.db -
// without a persistent volume, the database resets on every redeploy/restart.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Load .env from project root — handles both standard KEY=VALUE and
// Windows-style "set KEY=VALUE && ..." lines
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim().replace(/^set\s+/i, '').split('&&')[0].trim();
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
})();

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'movements.db');
const db = new DatabaseSync(DB_PATH);

// Shared PIN that unlocks the Admin page and every admin-only API call below.
// Must be set via ADMIN_PIN in .env — server generates a random one and logs it if missing.
let ADMIN_PIN = process.env.ADMIN_PIN;
if (!ADMIN_PIN) {
  ADMIN_PIN = crypto.randomBytes(3).toString('hex').toUpperCase();
  console.warn(`\n⚠️  AMARAN: ADMIN_PIN tidak ditetapkan dalam .env`);
  console.warn(`⚠️  PIN rawak dijana untuk sesi ini: ${ADMIN_PIN}`);
  console.warn(`⚠️  Tetapkan ADMIN_PIN=${ADMIN_PIN} dalam .env untuk mengekalkan PIN ini.\n`);
}

// T-01: Server-side admin sessions — client stores a random token, not the PIN itself.
// Tokens expire after 2 hours; a background sweep cleans stale entries every 30 min.
const adminSessions = new Map(); // token → expiresAt (ms)
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours
function createAdminSession() {
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function isValidAdminSession(token) {
  if (!token) return false;
  const exp = adminSessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { adminSessions.delete(token); return false; }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of adminSessions) if (now > exp) adminSessions.delete(t);
}, 30 * 60 * 1000);

// Rate limiter for /api/admin/verify — 5 failures per 10 min triggers 15-min lockout.
const _loginAttempts = new Map();
const _MAX_FAILS = 5, _WINDOW_MS = 10 * 60 * 1000, _LOCKOUT_MS = 15 * 60 * 1000;
function _rateLimitCheck(ip) {
  const now = Date.now(), e = _loginAttempts.get(ip);
  if (!e || now - e.firstAttempt > _WINDOW_MS) return { locked: false };
  if (e.lockedUntil > now) return { locked: true, secondsLeft: Math.ceil((e.lockedUntil - now) / 1000) };
  return { locked: false };
}
function _rateLimitFail(ip) {
  const now = Date.now(), e = _loginAttempts.get(ip) || { count: 0, firstAttempt: now, lockedUntil: 0 };
  if (now - e.firstAttempt > _WINDOW_MS) { _loginAttempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 }); return; }
  e.count++;
  if (e.count >= _MAX_FAILS) e.lockedUntil = now + _LOCKOUT_MS;
  _loginAttempts.set(ip, e);
}
function _rateLimitClear(ip) { _loginAttempts.delete(ip); }

// Same domain rule as the frontend's ALLOWED_EMAIL_REGEX - checked again here
// so self-registration can't be bypassed by calling the API directly.
const ALLOWED_EMAIL_DOMAIN = /^[^@]+@moe\.gov\.my$/;

// The frontend files (index.html, manifest.json, sw.js, icons/) live one
// level up from this script, at the project root.
const STATIC_ROOT = path.join(__dirname, '..');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

// S-01: Security headers applied to every response
const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(STATIC_ROOT, relativePath);

  // Guard against path traversal (e.g. "/../server/server.js")
  if (!fullPath.startsWith(STATIC_ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const contentType = MIME_TYPES[path.extname(fullPath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS });
    res.end(data);
  });
}

db.exec(`
  CREATE TABLE IF NOT EXISTS movements (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    tarikh TEXT NOT NULL,
    destinasi TEXT NOT NULL,
    tujuan TEXT NOT NULL,
    nota TEXT,
    masa TEXT,
    submittedBy TEXT NOT NULL
  )
`);
// Add masa column to existing databases that predate this field
try { db.exec(`ALTER TABLE movements ADD COLUMN masa TEXT DEFAULT ''`); } catch (_) {}
// Add sektor column to existing databases that predate this field
try { db.exec(`ALTER TABLE movements ADD COLUMN sektor TEXT DEFAULT 'SPr'`); } catch (_) {}
// T-04: indexes for common query patterns (tarikh, sektor, submittedBy)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mv_tarikh ON movements(tarikh)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mv_sektor ON movements(sektor)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mv_by ON movements(submittedBy)`); } catch (_) {}

// Staff roster - only e-mails an admin has added here may sign in. This is
// what gives "delete a user" real meaning (it revokes their ability to log
// in), rather than just being a display list.
db.exec(`
  CREATE TABLE IF NOT EXISTS staff (
    email TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    jawatan TEXT NOT NULL,
    addedAt TEXT NOT NULL,
    sektor TEXT DEFAULT 'SPr'
  )
`);
try { db.exec(`ALTER TABLE staff ADD COLUMN sektor TEXT DEFAULT 'SPr'`); } catch (_) {}

// Jawatan options shown in the identify form's dropdown - admin-editable
// instead of hardcoded in the frontend.
db.exec(`
  CREATE TABLE IF NOT EXISTS jawatan_list (
    jawatan TEXT PRIMARY KEY
  )
`);
const jawatanCount = db.prepare('SELECT COUNT(*) AS n FROM jawatan_list').get().n;
if (jawatanCount === 0) {
  const seedJawatan = db.prepare('INSERT INTO jawatan_list (jawatan) VALUES (?)');
  seedJawatan.run('Penolong Pegawai Pendidikan');
  seedJawatan.run('Timbalan Sektor Perancangan');
}

// S-04: Auto-purge audit_log entries older than 6 months (runs once at startup + daily)
function purgeOldAuditLog() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  db.prepare('DELETE FROM audit_log WHERE performedAt < ?').run(cutoff.toISOString());
}
purgeOldAuditLog();
setInterval(purgeOldAuditLog, 24 * 60 * 60 * 1000);

// Simple audit trail for admin actions (record deletions via admin override,
// and staff/jawatan roster changes) - deleted records otherwise vanish with
// no trace of who removed them or when.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    performedAt TEXT NOT NULL
  )
`);

function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

function logAudit(action, detail) {
  db.prepare('INSERT INTO audit_log (id, action, detail, performedAt) VALUES (?, ?, ?, ?)')
    .run(generateId(), action, detail, new Date().toISOString());
}

function isStaffEmail(email) {
  return !!db.prepare('SELECT 1 FROM staff WHERE email = ?').get(email);
}

// T-03: restrict CORS to same-origin LAN use only (no wildcard)
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3001',
  `http://127.0.0.1:${process.env.PORT || 3001}`,
]);
function getCorsHeaders(req) {
  const origin = req.headers['origin'] || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'http://localhost:3001';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin, X-Admin-Token',
    'Vary': 'Origin',
  };
}
const CORS_HEADERS = getCorsHeaders({ headers: {} }); // fallback for non-request contexts

function sendJSON(res, status, data) {
  const cors = res._req ? getCorsHeaders(res._req) : CORS_HEADERS;
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const MAX_BODY = 65536; // 64 KB — K-04: reject oversized payloads
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        req.destroy(Object.assign(new Error('Payload terlalu besar'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res._req = req; // T-03: make req available to sendJSON for per-request CORS
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  try {
    // GET /api/movements?sektor=SPr&email=... - list records, optionally filtered by sector
    // K-02: requires a valid staff email so anonymous callers cannot dump all movement data
    if (url.pathname === '/api/movements' && req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').trim().toLowerCase();
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];
      if (!isValidAdminSession(token) && pin !== ADMIN_PIN) {
        if (!email || !isStaffEmail(email)) {
          sendJSON(res, 401, { error: 'Akses tidak dibenarkan. Sila log masuk.' });
          return;
        }
      }
      const sektor = url.searchParams.get('sektor');
      const rows = sektor
        ? db.prepare('SELECT * FROM movements WHERE sektor = ? ORDER BY tarikh DESC').all(sektor)
        : db.prepare('SELECT * FROM movements ORDER BY tarikh DESC').all();
      sendJSON(res, 200, rows);
      return;
    }

    // POST /api/movements - create a new record. Only e-mails on the staff
    // roster may submit, mirroring the login gate (closes the gap where
    // someone could otherwise POST directly bypassing the identify form).
    if (url.pathname === '/api/movements' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { id, nama, tarikh, destinasi, tujuan, nota, masa, submittedBy, sektor } = body;

      if (!id || !nama || !tarikh || !destinasi || !tujuan || !submittedBy) {
        sendJSON(res, 400, { error: 'Missing required fields' });
        return;
      }
      if (nama.length > 150 || destinasi.length > 300 || (nota && nota.length > 1000) || tujuan.length > 200) {
        sendJSON(res, 400, { error: 'Input melebihi had panjang yang dibenarkan' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh) || isNaN(Date.parse(tarikh))) {
        sendJSON(res, 400, { error: 'Format tarikh tidak sah' });
        return;
      }
      if (!isStaffEmail(submittedBy)) {
        sendJSON(res, 403, { error: 'This e-mail is not on the staff roster' });
        return;
      }
      const existing = db.prepare('SELECT id FROM movements WHERE submittedBy = ? AND tarikh = ? AND destinasi = ? AND tujuan = ?').get(submittedBy, tarikh, destinasi, tujuan);
      if (existing) {
        sendJSON(res, 409, { error: 'Rekod yang sama sudah wujud untuk tarikh dan destinasi ini' });
        return;
      }

      db.prepare(`
        INSERT INTO movements (id, nama, tarikh, destinasi, tujuan, nota, masa, submittedBy, sektor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, nama, tarikh, destinasi, tujuan, nota || '', masa || '', submittedBy, sektor || 'SPr');

      sendJSON(res, 201, { ok: true });
      return;
    }

    // DELETE /api/movements - clear everything (requires admin session)
    if (url.pathname === '/api/movements' && req.method === 'DELETE') {
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];
      if (!isValidAdminSession(token) && pin !== ADMIN_PIN) {
        sendJSON(res, 403, { error: 'Admin session diperlukan untuk memadam semua rekod' });
        return;
      }
      db.prepare('DELETE FROM movements').run();
      logAudit('reset_all', 'Admin memadam semua rekod pergerakan');
      sendJSON(res, 200, { ok: true });
      return;
    }

    // DELETE /api/movements/:id?email=...      - owner deletes their own record
    // DELETE /api/movements/:id (X-Admin-Pin)  - admin deletes ANY record
    if (url.pathname.startsWith('/api/movements/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const requesterEmail = url.searchParams.get('email');
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];

      const record = db.prepare('SELECT * FROM movements WHERE id = ?').get(id);
      if (!record) {
        sendJSON(res, 404, { error: 'Record not found' });
        return;
      }

      const isOwner = requesterEmail && record.submittedBy === requesterEmail;
      const isAdmin = isValidAdminSession(token) || (pin && pin === ADMIN_PIN);

      if (!isOwner && !isAdmin) {
        sendJSON(res, 403, { error: 'You may only delete your own records' });
        return;
      }

      db.prepare('DELETE FROM movements WHERE id = ?').run(id);
      if (isAdmin && !isOwner) {
        logAudit('delete_record', `Admin memadam rekod pergerakan ${record.nama} (${record.tarikh}, ${record.destinasi}) yang dikemukakan oleh ${record.submittedBy}`);
      }
      sendJSON(res, 200, { ok: true });
      return;
    }

    // PATCH /api/movements/:id?email=... - owner edits their own record
    if (url.pathname.startsWith('/api/movements/') && req.method === 'PATCH') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const requesterEmail = (url.searchParams.get('email') || '').toLowerCase();
      const body = await readJsonBody(req);

      const record = db.prepare('SELECT * FROM movements WHERE id = ?').get(id);
      if (!record) { sendJSON(res, 404, { error: 'Rekod tidak dijumpai' }); return; }
      if (!requesterEmail || record.submittedBy !== requesterEmail) {
        sendJSON(res, 403, { error: 'Anda hanya boleh mengedit rekod sendiri' }); return;
      }

      const destinasi = (body.destinasi || record.destinasi).trim();
      const tujuan = (body.tujuan || record.tujuan).trim();
      const nota = body.nota !== undefined ? body.nota : record.nota;
      const masa = body.masa !== undefined ? body.masa : record.masa;
      const tarikh = body.tarikh || record.tarikh;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh) || isNaN(Date.parse(tarikh))) {
        sendJSON(res, 400, { error: 'Format tarikh tidak sah' }); return;
      }
      if (destinasi.length > 300 || tujuan.length > 200 || (nota && nota.length > 1000)) {
        sendJSON(res, 400, { error: 'Input melebihi had panjang' }); return;
      }

      db.prepare('UPDATE movements SET destinasi=?, tujuan=?, nota=?, masa=?, tarikh=? WHERE id=?')
        .run(destinasi, tujuan, nota || '', masa || '', tarikh, id);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // GET /api/jawatan - public list of position options for the identify form
    if (url.pathname === '/api/jawatan' && req.method === 'GET') {
      const rows = db.prepare('SELECT jawatan FROM jawatan_list ORDER BY jawatan ASC').all();
      sendJSON(res, 200, rows.map((r) => r.jawatan));
      return;
    }

    // GET /api/staff/check?email=... - public yes/no roster lookup used by the login gate
    if (url.pathname === '/api/staff/check' && req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const staff = db.prepare('SELECT email, nama, jawatan, sektor FROM staff WHERE email = ?').get(email) || null;
      sendJSON(res, 200, { allowed: !!staff, staff });
      return;
    }

    // GET /api/staff/list?sektor=... - list staff for a sector (or all)
    if (url.pathname === '/api/staff/list' && req.method === 'GET') {
      const sektor = url.searchParams.get('sektor');
      const rows = sektor
        ? db.prepare('SELECT nama, jawatan, sektor FROM staff WHERE sektor = ? ORDER BY nama').all(sektor)
        : db.prepare('SELECT nama, jawatan, sektor FROM staff ORDER BY sektor, nama').all();
      sendJSON(res, 200, { staff: rows });
      return;
    }

    // POST /api/staff/register {email, nama, jawatan} - public self-registration,
    // used the first time someone signs in. No PIN needed - anyone with a valid
    // MOE e-mail can add themselves. Admins can still add/remove staff directly
    // from the Admin panel regardless of this.
    if (url.pathname === '/api/staff/register' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const nama = (body.nama || '').trim();
      const jawatan = body.jawatan || '';
      const sektor = body.sektor || 'SPr';

      // T-06: input length limits on self-registration
      if (!ALLOWED_EMAIL_DOMAIN.test(email) || !nama || !jawatan) {
        sendJSON(res, 400, { error: 'Invalid registration details' });
        return;
      }
      if (nama.length > 100 || jawatan.length > 150 || email.length > 254) {
        sendJSON(res, 400, { error: 'Input melebihi had panjang yang dibenarkan' });
        return;
      }

      // K-05: INSERT OR IGNORE — self-registration cannot overwrite an existing record;
      // admins must use /api/admin/staff to update existing staff details.
      const inserted = db.prepare('INSERT OR IGNORE INTO staff (email, nama, jawatan, addedAt, sektor) VALUES (?, ?, ?, ?, ?)')
        .run(email, nama, jawatan, new Date().toISOString(), sektor);
      if (inserted.changes > 0) {
        logAudit('self_register', `${nama} (${email}, ${jawatan}, ${sektor}) mendaftar sebagai pengguna baharu`);
      }
      sendJSON(res, 201, { ok: true });
      return;
    }

    // ---- Everything below requires the admin PIN ----

    // POST /api/admin/verify {pin} - used to unlock the Admin tab in the UI
    if (url.pathname === '/api/admin/verify' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const rateCheck = _rateLimitCheck(ip);
      if (rateCheck.locked) {
        const mins = Math.ceil(rateCheck.secondsLeft / 60);
        sendJSON(res, 429, { error: `Terlalu banyak percubaan gagal. Cuba semula dalam ${mins} minit.` });
        return;
      }
      const body = await readJsonBody(req);
      const ok = body.pin === ADMIN_PIN;
      if (ok) {
        _rateLimitClear(ip);
        const token = createAdminSession(); // T-01: return token, not the PIN
        sendJSON(res, 200, { ok, token });
      } else {
        _rateLimitFail(ip);
        sendJSON(res, 200, { ok: false });
      }
      return;
    }

    if (url.pathname.startsWith('/api/admin/')) {
      // T-01: accept session token (X-Admin-Token) OR legacy PIN (X-Admin-Pin) for backward compat
      const bodyForWrite = (req.method === 'POST' || req.method === 'PATCH') ? await readJsonBody(req) : null;
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'] || (bodyForWrite && bodyForWrite.pin);

      if (!isValidAdminSession(token) && pin !== ADMIN_PIN) {
        sendJSON(res, 403, { error: 'Invalid admin session' });
        return;
      }

      // GET /api/admin/staff - list the roster
      if (url.pathname === '/api/admin/staff' && req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM staff ORDER BY addedAt DESC').all();
        sendJSON(res, 200, rows);
        return;
      }

      // POST /api/admin/staff {pin, email, nama, jawatan} - add a staff member
      if (url.pathname === '/api/admin/staff' && req.method === 'POST') {
        const { email, nama, jawatan } = bodyForWrite;
        if (!email || !nama || !jawatan) {
          sendJSON(res, 400, { error: 'Missing required fields' });
          return;
        }
        const normalizedEmail = email.trim().toLowerCase();
        db.prepare('INSERT OR REPLACE INTO staff (email, nama, jawatan, addedAt, sektor) VALUES (?, ?, ?, ?, ?)')
          .run(normalizedEmail, nama.trim(), jawatan, new Date().toISOString(), bodyForWrite.sektor || 'SPr');
        logAudit('add_staff', `Admin menambah/mengemaskini staf ${nama.trim()} (${normalizedEmail}, ${jawatan})`);
        sendJSON(res, 201, { ok: true });
        return;
      }

      // DELETE /api/admin/staff/:email?pin=... - revoke a staff member's access
      if (url.pathname.startsWith('/api/admin/staff/') && req.method === 'DELETE') {
        const email = decodeURIComponent(url.pathname.split('/').pop());
        const staffMember = db.prepare('SELECT * FROM staff WHERE email = ?').get(email);
        db.prepare('DELETE FROM staff WHERE email = ?').run(email);
        if (staffMember) {
          logAudit('delete_staff', `Admin memadam staf ${staffMember.nama} (${email})`);
        }
        sendJSON(res, 200, { ok: true });
        return;
      }

      // POST /api/admin/jawatan {pin, jawatan} - add a position option
      if (url.pathname === '/api/admin/jawatan' && req.method === 'POST') {
        const { jawatan } = bodyForWrite;
        if (!jawatan || !jawatan.trim()) {
          sendJSON(res, 400, { error: 'Missing jawatan value' });
          return;
        }
        db.prepare('INSERT OR IGNORE INTO jawatan_list (jawatan) VALUES (?)').run(jawatan.trim());
        logAudit('add_jawatan', `Admin menambah jawatan baharu: "${jawatan.trim()}"`);
        sendJSON(res, 201, { ok: true });
        return;
      }

      // DELETE /api/admin/jawatan/:value?pin=... - remove a position option
      if (url.pathname.startsWith('/api/admin/jawatan/') && req.method === 'DELETE') {
        const value = decodeURIComponent(url.pathname.split('/').pop());
        db.prepare('DELETE FROM jawatan_list WHERE jawatan = ?').run(value);
        logAudit('delete_jawatan', `Admin membuang jawatan: "${value}"`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // PATCH /api/admin/staff/:email/sektor - update staff sector
      if (url.pathname.match(/^\/api\/admin\/staff\/[^/]+\/sektor$/) && req.method === 'PATCH') {
        const email = decodeURIComponent(url.pathname.split('/')[4]);
        const { sektor } = bodyForWrite;
        if (!sektor) { sendJSON(res, 400, { error: 'Missing sektor' }); return; }
        const staffMember = db.prepare('SELECT * FROM staff WHERE email = ?').get(email);
        if (!staffMember) { sendJSON(res, 404, { error: 'Staf tidak dijumpai' }); return; }
        db.prepare('UPDATE staff SET sektor = ? WHERE email = ?').run(sektor, email);
        logAudit('update_sektor', `Admin menukar sektor ${staffMember.nama} (${email}) daripada ${staffMember.sektor} kepada ${sektor}`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // POST /api/admin/staff/:email/reset - remove staff registration (force re-register)
      if (url.pathname.match(/^\/api\/admin\/staff\/[^/]+\/reset$/) && req.method === 'POST') {
        const email = decodeURIComponent(url.pathname.split('/')[4]);
        const staffMember = db.prepare('SELECT * FROM staff WHERE email = ?').get(email);
        if (!staffMember) { sendJSON(res, 404, { error: 'Staf tidak dijumpai' }); return; }
        db.prepare('DELETE FROM staff WHERE email = ?').run(email);
        logAudit('reset_staff', `Admin menetapkan semula pendaftaran ${staffMember.nama} (${email})`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // GET /api/admin/audit - recent admin activity
      if (url.pathname === '/api/admin/audit' && req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM audit_log ORDER BY performedAt DESC LIMIT 200').all();
        sendJSON(res, 200, rows);
        return;
      }

      sendJSON(res, 404, { error: 'Not found' });
      return;
    }

    // POST /api/chat - Ejen e-Gerak PPD Dalat (DeepSeek-powered)
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
      if (!DEEPSEEK_API_KEY) {
        sendJSON(res, 503, { error: 'DEEPSEEK_API_KEY tidak dikonfigurasi pada pelayan.' });
        return;
      }
      const body = await readJsonBody(req);
      const userMessage = (body.message || '').trim();
      const sektor = (body.sektor || '').trim();
      const lang = (body.lang || 'bm').trim();
      if (!userMessage) { sendJSON(res, 400, { error: 'Mesej kosong.' }); return; }

      // Build movement context from DB
      const allRecords = db.prepare('SELECT * FROM movements ORDER BY tarikh DESC LIMIT 500').all();
      const todayStr = new Date().toLocaleDateString('en-CA');
      const contextLines = allRecords.map(r =>
        `- ${r.nama} | ${r.sektor || '-'} | ${r.tarikh} | Tujuan: ${r.tujuan} | Destinasi: ${r.destinasi} | Balik: ${r.masa_balik || 'tidak dinyatakan'}`
      ).join('\n');

      const systemPrompt = lang === 'en'
        ? `You are the e-Gerak PPD Dalat Agent. Answer in English, BRIEF and CONCISE — maximum 3-4 sentences or a short list. Go straight to the facts, no lengthy introductions.\n\nRole: help users check officer whereabouts based on movement records.\nToday's date: ${todayStr}\nUser sector: ${sektor || 'unknown'}\n\nMOVEMENT RECORDS:\n${contextLines || 'No records.'}\n\nAnswer rules:\n- If the question is about today, filter records dated ${todayStr} only\n- If no relevant records, say "No records for that date/officer"\n- Do not alter data, do not make assumptions\n- Brief format: name → destination → purpose`
        : `Anda ialah Ejen e-Gerak PPD Dalat. Jawab dalam Bahasa Melayu, RINGKAS dan PADAT — maksimum 3-4 ayat atau senarai pendek. Terus kepada fakta, tiada ayat pengenalan panjang.\n\nPeranan: bantu pengguna semak keberadaan pegawai berdasarkan rekod pergerakan.\nTarikh hari ini: ${todayStr}\nSektor pengguna: ${sektor || 'tidak diketahui'}\n\nREKOD PERGERAKAN:\n${contextLines || 'Tiada rekod.'}\n\nPeraturan jawapan:\n- Jika soalan tentang hari ini, tapis rekod bertarikh ${todayStr} sahaja\n- Jika tiada rekod berkaitan, kata "Tiada rekod untuk tarikh/pegawai tersebut"\n- Jangan ubah data, jangan buat andaian\n- Format ringkas: nama → destinasi → tujuan`;

      const deepseekBody = JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 1024,
        temperature: 0.2
      });

      const https = require('node:https');
      const dsReq = https.request({
        hostname: 'api.deepseek.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Length': Buffer.byteLength(deepseekBody),
        }
      }, (dsRes) => {
        let raw = '';
        dsRes.on('data', c => { raw += c; });
        dsRes.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              console.error('[DeepSeek] error:', JSON.stringify(parsed.error));
              sendJSON(res, 502, { error: `DeepSeek: ${parsed.error.message || JSON.stringify(parsed.error)}` });
              return;
            }
            const reply = parsed?.choices?.[0]?.message?.content || 'Maaf, tiada respons daripada model.';
            sendJSON(res, 200, { reply });
          } catch (e) {
            console.error('[DeepSeek] parse error:', e.message, '| raw:', raw.slice(0, 300));
            sendJSON(res, 500, { error: 'Gagal membaca respons DeepSeek.' });
          }
        });
      });
      dsReq.on('error', (e) => sendJSON(res, 500, { error: `Ralat sambungan: ${e.message}` }));
      dsReq.write(deepseekBody);
      dsReq.end();
      return;
    }

    // Anything else (GET requests for the page/assets) - serve the frontend files
    if (!url.pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`e-Gerak SPR backend listening on port ${PORT}`);
});
