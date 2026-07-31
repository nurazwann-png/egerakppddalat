// Backend + static file server for e-Gerak SPR - one process serves both the
// app (index.html, manifest, icons) and the shared /api/movements data, so
// staff on other devices just need one URL, e.g. http://<this-pc's-LAN-IP>:3001
// (find that IP with `ipconfig` on Windows), rather than running two servers.
//
// Uses Node built-ins + the `pg` package for PostgreSQL.
// Run with: node server/server.js
//
// Set DATABASE_URL in .env, e.g.:
//   postgresql://user:password@localhost:5432/egerak

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// Load .env from project root
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

// Cloud Run: sambung via Unix socket (INSTANCE_CONNECTION_NAME)
// Tempatan: sambung via DATABASE_URL
const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;
const pool = instanceConnectionName
  ? new Pool({
      host: `/cloudsql/${instanceConnectionName}`,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'egerak',
    })
  : new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false
        : process.env.DATABASE_SSL === 'false' ? false
        : { rejectUnauthorized: false }
    });

let ADMIN_PIN = process.env.ADMIN_PIN;
if (!ADMIN_PIN) {
  ADMIN_PIN = crypto.randomBytes(3).toString('hex').toUpperCase();
  console.warn(`\n⚠️  AMARAN: ADMIN_PIN tidak ditetapkan dalam .env`);
  console.warn(`⚠️  PIN rawak dijana untuk sesi ini: ${ADMIN_PIN}`);
  console.warn(`⚠️  Tetapkan ADMIN_PIN=${ADMIN_PIN} dalam .env untuk mengekalkan PIN ini.\n`);
}

// ── Email transporter ────────────────────────────────────────────────────────
const emailTransporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// In-memory store: email → { code, expiresAt, data }
const _pendingVerifications = new Map();
const VERIFICATION_TTL = 10 * 60 * 1000; // 10 minit
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _pendingVerifications) {
    if (now > v.expiresAt) _pendingVerifications.delete(k);
  }
}, 5 * 60 * 1000);

async function sendVerificationEmail(toEmail, code, nama) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    // Development fallback — log to console
    console.log(`\n[DEV] Kod verifikasi untuk ${toEmail}: ${code}\n`);
    return;
  }
  await emailTransporter.sendMail({
    from: `"e-Gerak PPD Dalat" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Kod Aktivasi e-Gerak PPD Dalat',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="background:#1B3A6B;padding:24px;text-align:center">
          <h2 style="color:#fff;margin:0">e-Gerak PPD Dalat</h2>
        </div>
        <div style="padding:32px">
          <p>Salam ${nama},</p>
          <p>Anda telah memohon untuk mendaftar akaun baharu dalam sistem <strong>e-Gerak PPD Dalat</strong>.</p>
          <p>Kod aktivasi anda ialah:</p>
          <div style="background:#F3F4F6;border-radius:8px;padding:20px;text-align:center;margin:24px 0">
            <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#1B3A6B">${code}</span>
          </div>
          <p style="color:#6B7280;font-size:13px">Kod ini sah selama <strong>10 minit</strong>. Jangan kongsi kod ini dengan sesiapa.</p>
          <p style="color:#6B7280;font-size:13px">Jika anda tidak membuat permohonan ini, abaikan e-mel ini.</p>
        </div>
        <div style="background:#F3F4F6;padding:16px;text-align:center;font-size:12px;color:#9CA3AF">
          PPD Dalat &bull; Sistem e-Gerak
        </div>
      </div>`,
  });
}

const adminSessions = new Map();
const SESSION_TTL = 2 * 60 * 60 * 1000;
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

const _loginAttempts = new Map();
const _MAX_FAILS = 5, _WINDOW_MS = 10 * 60 * 1000, _LOCKOUT_MS = 15 * 60 * 1000;
// Bersihkan entri lama setiap 30 minit untuk elak memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of _loginAttempts) {
    if (now - e.firstAttempt > _WINDOW_MS && e.lockedUntil < now) _loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);
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

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Lakukan perbandingan palsu untuk elak timing attack berdasarkan panjang
    crypto.timingSafeEqual(Buffer.from(b), Buffer.from(b));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const ALLOWED_EMAIL_DOMAIN = /^[^@]+@moe\.gov\.my$/;

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

const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self';",
};

function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(STATIC_ROOT, relativePath);
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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      tarikh TEXT NOT NULL,
      destinasi TEXT NOT NULL,
      tujuan TEXT NOT NULL,
      nota TEXT,
      masa TEXT DEFAULT '',
      submittedby TEXT NOT NULL,
      sektor TEXT DEFAULT 'SPr'
    )
  `);
  await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS masa TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE movements ADD COLUMN IF NOT EXISTS sektor TEXT DEFAULT 'SPr'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mv_tarikh ON movements(tarikh)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mv_sektor ON movements(sektor)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mv_by ON movements(submittedby)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      email TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      jawatan TEXT NOT NULL,
      addedat TEXT NOT NULL,
      sektor TEXT DEFAULT 'SPr'
    )
  `);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS sektor TEXT DEFAULT 'SPr'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jawatan_list (
      jawatan TEXT PRIMARY KEY
    )
  `);
  const { rows: jRows } = await pool.query('SELECT COUNT(*) AS n FROM jawatan_list');
  if (parseInt(jRows[0].n) === 0) {
    await pool.query(`INSERT INTO jawatan_list (jawatan) VALUES ($1) ON CONFLICT DO NOTHING`, ['Penolong Pegawai Pendidikan']);
    await pool.query(`INSERT INTO jawatan_list (jawatan) VALUES ($1) ON CONFLICT DO NOTHING`, ['Timbalan Sektor Perancangan']);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      performedat TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      tajuk TEXT NOT NULL,
      isi TEXT NOT NULL,
      created_by TEXT NOT NULL,
      nama TEXT NOT NULL,
      sektor TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

async function purgeOldAuditLog() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  await pool.query(`DELETE FROM audit_log WHERE performedat < $1`, [cutoff.toISOString()]);
}

function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

async function logAudit(action, detail) {
  await pool.query(
    `INSERT INTO audit_log (id, action, detail, performedat) VALUES ($1, $2, $3, $4)`,
    [generateId(), action, detail, new Date().toISOString()]
  );
}

async function isStaffEmail(email) {
  const { rows } = await pool.query('SELECT 1 FROM staff WHERE email = $1', [email]);
  return rows.length > 0;
}

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3001',
  'http://localhost:8118',
  `http://127.0.0.1:${process.env.PORT || 3001}`,
  ...(process.env.CLOUD_RUN_ORIGIN ? [process.env.CLOUD_RUN_ORIGIN] : []),
]);
function getCorsHeaders(req) {
  const origin = req.headers['origin'] || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'http://localhost:3001';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin, X-Admin-Token',
    'Vary': 'Origin',
  };
}
const CORS_HEADERS = getCorsHeaders({ headers: {} });

function sendJSON(res, status, data) {
  const cors = res._req ? getCorsHeaders(res._req) : CORS_HEADERS;
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const MAX_BODY = 65536;
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
  res._req = req;
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, getCorsHeaders(req));
    res.end();
    return;
  }

  // Health check untuk GCP Cloud Run
  if (url.pathname === '/healthz' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  try {
    // GET /api/movements
    if (url.pathname === '/api/movements' && req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').trim().toLowerCase();
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];
      if (!isValidAdminSession(token) && pin !== ADMIN_PIN) {
        if (!email || !(await isStaffEmail(email))) {
          sendJSON(res, 401, { error: 'Akses tidak dibenarkan. Sila log masuk.' });
          return;
        }
      }
      const sektor = url.searchParams.get('sektor');
      const { rows } = sektor
        ? await pool.query('SELECT id, nama, tarikh, destinasi, tujuan, nota, masa, submittedby AS "submittedBy", sektor FROM movements WHERE sektor = $1 ORDER BY tarikh DESC', [sektor])
        : await pool.query('SELECT id, nama, tarikh, destinasi, tujuan, nota, masa, submittedby AS "submittedBy", sektor FROM movements ORDER BY tarikh DESC');
      sendJSON(res, 200, rows);
      return;
    }

    // POST /api/movements
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
      if (!(await isStaffEmail(submittedBy))) {
        sendJSON(res, 403, { error: 'This e-mail is not on the staff roster' });
        return;
      }
      const { rows: existing } = await pool.query(
        'SELECT id FROM movements WHERE submittedby = $1 AND tarikh = $2 AND destinasi = $3 AND tujuan = $4',
        [submittedBy, tarikh, destinasi, tujuan]
      );
      if (existing.length > 0) {
        sendJSON(res, 409, { error: 'Rekod yang sama sudah wujud untuk tarikh dan destinasi ini' });
        return;
      }

      await pool.query(
        `INSERT INTO movements (id, nama, tarikh, destinasi, tujuan, nota, masa, submittedby, sektor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, nama, tarikh, destinasi, tujuan, nota || '', masa || '', submittedBy, sektor || 'SPr']
      );
      sendJSON(res, 201, { ok: true });
      return;
    }

    // DELETE /api/movements (clear all — admin)
    if (url.pathname === '/api/movements' && req.method === 'DELETE') {
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];
      if (!isValidAdminSession(token) && pin !== ADMIN_PIN) {
        sendJSON(res, 403, { error: 'Admin session diperlukan untuk memadam semua rekod' });
        return;
      }
      await pool.query('DELETE FROM movements');
      await logAudit('reset_all', 'Admin memadam semua rekod pergerakan');
      sendJSON(res, 200, { ok: true });
      return;
    }

    // DELETE /api/movements/:id
    if (url.pathname.startsWith('/api/movements/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const requesterEmail = url.searchParams.get('email');
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'];

      const { rows } = await pool.query('SELECT * FROM movements WHERE id = $1', [id]);
      const record = rows[0];
      if (!record) {
        sendJSON(res, 404, { error: 'Record not found' });
        return;
      }

      const isOwner = requesterEmail && record.submittedby === requesterEmail;
      const isAdmin = isValidAdminSession(token) || (pin && pin === ADMIN_PIN);

      if (!isOwner && !isAdmin) {
        sendJSON(res, 403, { error: 'You may only delete your own records' });
        return;
      }

      await pool.query('DELETE FROM movements WHERE id = $1', [id]);
      if (isAdmin && !isOwner) {
        await logAudit('delete_record', `Admin memadam rekod pergerakan ${record.nama} (${record.tarikh}, ${record.destinasi}) yang dikemukakan oleh ${record.submittedby}`);
      }
      sendJSON(res, 200, { ok: true });
      return;
    }

    // PATCH /api/movements/:id
    if (url.pathname.startsWith('/api/movements/') && req.method === 'PATCH') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const requesterEmail = (url.searchParams.get('email') || '').toLowerCase();
      const body = await readJsonBody(req);

      const { rows } = await pool.query('SELECT * FROM movements WHERE id = $1', [id]);
      const record = rows[0];
      if (!record) { sendJSON(res, 404, { error: 'Rekod tidak dijumpai' }); return; }
      if (!requesterEmail || record.submittedby !== requesterEmail) {
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

      await pool.query(
        'UPDATE movements SET destinasi=$1, tujuan=$2, nota=$3, masa=$4, tarikh=$5 WHERE id=$6',
        [destinasi, tujuan, nota || '', masa || '', tarikh, id]
      );
      sendJSON(res, 200, { ok: true });
      return;
    }

    // GET /api/jawatan
    if (url.pathname === '/api/jawatan' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT jawatan FROM jawatan_list ORDER BY jawatan ASC');
      sendJSON(res, 200, rows.map((r) => r.jawatan));
      return;
    }

    // GET /api/staff/check
    if (url.pathname === '/api/staff/check' && req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const { rows } = await pool.query('SELECT email, nama, jawatan, sektor FROM staff WHERE email = $1', [email]);
      const staff = rows[0] || null;
      sendJSON(res, 200, { allowed: !!staff, staff });
      return;
    }

    // GET /api/staff/list
    if (url.pathname === '/api/staff/list' && req.method === 'GET') {
      const sektor = url.searchParams.get('sektor');
      const { rows } = sektor
        ? await pool.query('SELECT nama, jawatan, sektor FROM staff WHERE sektor = $1 ORDER BY nama', [sektor])
        : await pool.query('SELECT nama, jawatan, sektor FROM staff ORDER BY sektor, nama');
      sendJSON(res, 200, { staff: rows });
      return;
    }

    // POST /api/staff/request-verification — hantar kod aktivasi ke emel
    if (url.pathname === '/api/staff/request-verification' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const nama = (body.nama || '').trim();
      const jawatan = body.jawatan || '';
      const sektor = body.sektor || 'SPr';

      if (!ALLOWED_EMAIL_DOMAIN.test(email) || !nama || !jawatan) {
        sendJSON(res, 400, { error: 'Maklumat pendaftaran tidak lengkap.' });
        return;
      }
      if (nama.length > 100 || jawatan.length > 150 || email.length > 254) {
        sendJSON(res, 400, { error: 'Input melebihi had panjang yang dibenarkan.' });
        return;
      }

      // Semak jika sudah berdaftar
      const existing = await pool.query('SELECT 1 FROM staff WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        // Sudah berdaftar — benarkan terus tanpa perlu kod
        sendJSON(res, 200, { ok: true, alreadyRegistered: true });
        return;
      }

      // Jana kod 6-digit
      const code = String(Math.floor(100000 + crypto.randomInt(900000))).padStart(6, '0');
      _pendingVerifications.set(email, {
        code,
        expiresAt: Date.now() + VERIFICATION_TTL,
        data: { email, nama, jawatan, sektor },
      });

      try {
        await sendVerificationEmail(email, code, nama);
      } catch (err) {
        console.error('Gagal hantar emel verifikasi:', err.message);
        sendJSON(res, 500, { error: 'Gagal menghantar e-mel. Sila cuba lagi.' });
        return;
      }

      sendJSON(res, 200, { ok: true, alreadyRegistered: false });
      return;
    }

    // POST /api/staff/verify-code — sahkan kod dan daftarkan staf
    if (url.pathname === '/api/staff/verify-code' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const code = (body.code || '').trim();

      const pending = _pendingVerifications.get(email);
      if (!pending) {
        sendJSON(res, 400, { error: 'Tiada permohonan verifikasi ditemui. Sila mulakan semula.' });
        return;
      }
      if (Date.now() > pending.expiresAt) {
        _pendingVerifications.delete(email);
        sendJSON(res, 400, { error: 'Kod aktivasi telah tamat tempoh. Sila minta kod baharu.' });
        return;
      }
      if (code !== pending.code) {
        sendJSON(res, 400, { error: 'Kod aktivasi tidak sah. Sila semak e-mel anda.' });
        return;
      }

      // Kod betul — daftarkan staf
      const { nama, jawatan, sektor } = pending.data;
      _pendingVerifications.delete(email);

      const result = await pool.query(
        `INSERT INTO staff (email, nama, jawatan, addedat, sektor) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [email, nama, jawatan, new Date().toISOString(), sektor]
      );
      if (result.rowCount > 0) {
        await logAudit('self_register', `${nama} (${email}, ${jawatan}, ${sektor}) mendaftar sebagai pengguna baharu (disahkan melalui e-mel)`);
      }
      sendJSON(res, 201, { ok: true });
      return;
    }

    // POST /api/staff/register (legacy — hanya untuk staf yang sudah berdaftar semula)
    if (url.pathname === '/api/staff/register' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = (body.email || '').trim().toLowerCase();
      const nama = (body.nama || '').trim();
      const jawatan = body.jawatan || '';
      const sektor = body.sektor || 'SPr';

      if (!ALLOWED_EMAIL_DOMAIN.test(email) || !nama || !jawatan) {
        sendJSON(res, 400, { error: 'Invalid registration details' });
        return;
      }
      if (nama.length > 100 || jawatan.length > 150 || email.length > 254) {
        sendJSON(res, 400, { error: 'Input melebihi had panjang yang dibenarkan' });
        return;
      }

      const result = await pool.query(
        `INSERT INTO staff (email, nama, jawatan, addedat, sektor) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [email, nama, jawatan, new Date().toISOString(), sektor]
      );
      if (result.rowCount > 0) {
        await logAudit('self_register', `${nama} (${email}, ${jawatan}, ${sektor}) mendaftar sebagai pengguna baharu`);
      }
      sendJSON(res, 201, { ok: true });
      return;
    }

    // POST /api/admin/verify
    if (url.pathname === '/api/admin/verify' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const rateCheck = _rateLimitCheck(ip);
      if (rateCheck.locked) {
        const mins = Math.ceil(rateCheck.secondsLeft / 60);
        sendJSON(res, 429, { error: `Terlalu banyak percubaan gagal. Cuba semula dalam ${mins} minit.` });
        return;
      }
      const body = await readJsonBody(req);
      const ok = timingSafeEqual(body.pin, ADMIN_PIN);
      if (ok) {
        _rateLimitClear(ip);
        const token = createAdminSession();
        sendJSON(res, 200, { ok, token });
      } else {
        _rateLimitFail(ip);
        sendJSON(res, 200, { ok: false });
      }
      return;
    }

    if (url.pathname.startsWith('/api/admin/')) {
      const bodyForWrite = (req.method === 'POST' || req.method === 'PATCH') ? await readJsonBody(req) : null;
      const token = req.headers['x-admin-token'];
      const pin = req.headers['x-admin-pin'] || (bodyForWrite && bodyForWrite.pin);

      if (!isValidAdminSession(token) && !timingSafeEqual(pin, ADMIN_PIN)) {
        sendJSON(res, 403, { error: 'Invalid admin session' });
        return;
      }

      // GET /api/admin/staff
      if (url.pathname === '/api/admin/staff' && req.method === 'GET') {
        const { rows } = await pool.query(`SELECT * FROM staff ORDER BY addedat DESC`);
        sendJSON(res, 200, rows);
        return;
      }

      // POST /api/admin/staff
      if (url.pathname === '/api/admin/staff' && req.method === 'POST') {
        const { email, nama, jawatan } = bodyForWrite;
        if (!email || !nama || !jawatan) {
          sendJSON(res, 400, { error: 'Missing required fields' });
          return;
        }
        const normalizedEmail = email.trim().toLowerCase();
        await pool.query(
          `INSERT INTO staff (email, nama, jawatan, addedat, sektor) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (email) DO UPDATE SET nama=EXCLUDED.nama, jawatan=EXCLUDED.jawatan, sektor=EXCLUDED.sektor`,
          [normalizedEmail, nama.trim(), jawatan, new Date().toISOString(), bodyForWrite.sektor || 'SPr']
        );
        await logAudit('add_staff', `Admin menambah/mengemaskini staf ${nama.trim()} (${normalizedEmail}, ${jawatan})`);
        sendJSON(res, 201, { ok: true });
        return;
      }

      // DELETE /api/admin/staff/:email
      if (url.pathname.startsWith('/api/admin/staff/') && !url.pathname.includes('/sektor') && !url.pathname.includes('/reset') && req.method === 'DELETE') {
        const email = decodeURIComponent(url.pathname.split('/').pop());
        const { rows } = await pool.query('SELECT * FROM staff WHERE email = $1', [email]);
        const staffMember = rows[0];
        await pool.query('DELETE FROM staff WHERE email = $1', [email]);
        if (staffMember) {
          await logAudit('delete_staff', `Admin memadam staf ${staffMember.nama} (${email})`);
        }
        sendJSON(res, 200, { ok: true });
        return;
      }

      // POST /api/admin/jawatan
      if (url.pathname === '/api/admin/jawatan' && req.method === 'POST') {
        const { jawatan } = bodyForWrite;
        if (!jawatan || !jawatan.trim()) {
          sendJSON(res, 400, { error: 'Missing jawatan value' });
          return;
        }
        await pool.query(`INSERT INTO jawatan_list (jawatan) VALUES ($1) ON CONFLICT DO NOTHING`, [jawatan.trim()]);
        await logAudit('add_jawatan', `Admin menambah jawatan baharu: "${jawatan.trim()}"`);
        sendJSON(res, 201, { ok: true });
        return;
      }

      // DELETE /api/admin/jawatan/:value
      if (url.pathname.startsWith('/api/admin/jawatan/') && req.method === 'DELETE') {
        const value = decodeURIComponent(url.pathname.split('/').pop());
        await pool.query('DELETE FROM jawatan_list WHERE jawatan = $1', [value]);
        await logAudit('delete_jawatan', `Admin membuang jawatan: "${value}"`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // PATCH /api/admin/staff/:email/sektor
      if (url.pathname.match(/^\/api\/admin\/staff\/[^/]+\/sektor$/) && req.method === 'PATCH') {
        const email = decodeURIComponent(url.pathname.split('/')[4]);
        const { sektor } = bodyForWrite;
        if (!sektor) { sendJSON(res, 400, { error: 'Missing sektor' }); return; }
        const { rows } = await pool.query('SELECT * FROM staff WHERE email = $1', [email]);
        const staffMember = rows[0];
        if (!staffMember) { sendJSON(res, 404, { error: 'Staf tidak dijumpai' }); return; }
        await pool.query('UPDATE staff SET sektor = $1 WHERE email = $2', [sektor, email]);
        await logAudit('update_sektor', `Admin menukar sektor ${staffMember.nama} (${email}) daripada ${staffMember.sektor} kepada ${sektor}`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // POST /api/admin/staff/:email/reset
      if (url.pathname.match(/^\/api\/admin\/staff\/[^/]+\/reset$/) && req.method === 'POST') {
        const email = decodeURIComponent(url.pathname.split('/')[4]);
        const { rows } = await pool.query('SELECT * FROM staff WHERE email = $1', [email]);
        const staffMember = rows[0];
        if (!staffMember) { sendJSON(res, 404, { error: 'Staf tidak dijumpai' }); return; }
        await pool.query('DELETE FROM staff WHERE email = $1', [email]);
        await logAudit('reset_staff', `Admin menetapkan semula pendaftaran ${staffMember.nama} (${email})`);
        sendJSON(res, 200, { ok: true });
        return;
      }

      // GET /api/admin/audit
      if (url.pathname === '/api/admin/audit' && req.method === 'GET') {
        const { rows } = await pool.query(`SELECT * FROM audit_log ORDER BY performedat DESC LIMIT 200`);
        sendJSON(res, 200, rows);
        return;
      }

      sendJSON(res, 404, { error: 'Not found' });
      return;
    }

    // GET /api/notices
    if (url.pathname === '/api/notices' && req.method === 'GET') {
      const email = (url.searchParams.get('email') || '').trim().toLowerCase();
      const token = req.headers['x-admin-token'];
      if (!isValidAdminSession(token) && !(await isStaffEmail(email))) {
        sendJSON(res, 401, { error: 'Akses tidak dibenarkan.' }); return;
      }
      const { rows } = await pool.query('SELECT * FROM notices ORDER BY created_at DESC');
      sendJSON(res, 200, rows);
      return;
    }

    // POST /api/notices
    if (url.pathname === '/api/notices' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const { tajuk, isi, email, nama, sektor } = body;
      if (!tajuk || !isi || !email) { sendJSON(res, 400, { error: 'Tajuk, isi dan email diperlukan.' }); return; }
      if (!(await isStaffEmail(email.trim().toLowerCase()))) { sendJSON(res, 403, { error: 'Akses tidak dibenarkan.' }); return; }
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { rows: staffRows } = await pool.query('SELECT nama FROM staff WHERE email=$1', [email.trim().toLowerCase()]);
      const resolvedNama = (staffRows[0] && staffRows[0].nama) ? staffRows[0].nama : (nama || email).trim();
      await pool.query(
        `INSERT INTO notices (id,tajuk,isi,created_by,nama,sektor,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, tajuk.trim(), isi.trim(), email.trim().toLowerCase(), resolvedNama, (sektor||'').trim(), created_at]
      );
      sendJSON(res, 201, { id, tajuk, isi, nama: resolvedNama, sektor, created_at });
      return;
    }

    // DELETE /api/notices/:id
    if (url.pathname.startsWith('/api/notices/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const email = (url.searchParams.get('email') || '').trim().toLowerCase();
      const token = req.headers['x-admin-token'];
      const { rows } = await pool.query('SELECT * FROM notices WHERE id = $1', [id]);
      const notice = rows[0];
      if (!notice) { sendJSON(res, 404, { error: 'Pemakluman tidak dijumpai.' }); return; }
      if (!isValidAdminSession(token) && notice.created_by !== email) {
        sendJSON(res, 403, { error: 'Hanya pencipta atau admin boleh padam.' }); return;
      }
      await pool.query('DELETE FROM notices WHERE id = $1', [id]);
      sendJSON(res, 200, { ok: true });
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
      // Pengesahan: hanya staf sah boleh guna Ejen
      const chatEmail = (body.email || '').trim().toLowerCase();
      const chatToken = req.headers['x-admin-token'];
      if (!isValidAdminSession(chatToken) && !(await isStaffEmail(chatEmail))) {
        sendJSON(res, 401, { error: 'Akses tidak dibenarkan.' }); return;
      }
      const userMessage = (body.message || '').trim();
      const sektor = (body.sektor || '').trim();
      const lang = (body.lang || 'bm').trim();
      if (!userMessage) { sendJSON(res, 400, { error: 'Mesej kosong.' }); return; }

      const { rows: allRecords } = await pool.query('SELECT * FROM movements ORDER BY tarikh DESC LIMIT 500');
      const todayStr = new Date().toLocaleDateString('en-CA');
      const contextLines = allRecords.map(r =>
        `- ${r.nama} | ${r.sektor || '-'} | ${r.tarikh} | Tujuan: ${r.tujuan} | Destinasi: ${r.destinasi} | Balik: ${r.masa_balik || 'tidak dinyatakan'}`
      ).join('\n');

      const systemPrompt = lang === 'en'
        ? `You are a friendly assistant for e-Gerak PPD Dalat. Your job is to help staff check officer movement records in a warm, conversational tone — like a helpful colleague, not a system report.

STRICT RULES:
- NEVER use markdown: no **, no *, no #, no bullet dashes (-)
- Write in plain natural sentences
- Keep it SHORT: 2-4 sentences maximum, or a brief conversational list using numbers (1. 2. 3.) if listing multiple people
- Be warm and direct, like a chat message between colleagues
- Today's date: ${todayStr}
- User sector: ${sektor || 'unknown'}

MOVEMENT RECORDS:
${contextLines || 'No records found.'}

HOW TO ANSWER:
- For today's movements, only use records dated ${todayStr}
- If listing people: use "1. Name is at Destination (Purpose)" format
- If no records match: say it naturally, e.g. "Looks like no one is out today!"
- Never invent or assume data not in the records`
        : `Anda ialah pembantu mesra untuk sistem e-Gerak PPD Dalat. Tugas anda membantu kakitangan semak rekod pergerakan pegawai dengan nada perbualan yang mesra — seperti rakan sekerja yang membantu, bukan laporan sistem.

PERATURAN KETAT:
- JANGAN SEKALI-KALI guna markdown: tiada **, tiada *, tiada #, tiada senarai dengan tanda (-) atau (-)
- Tulis dalam ayat biasa yang natural
- PENDEK: maksimum 2-4 ayat, atau senarai ringkas menggunakan nombor (1. 2. 3.) jika ada banyak nama
- Nada mesra dan terus, seperti mesej WhatsApp antara rakan sekerja
- Tarikh hari ini: ${todayStr}
- Sektor pengguna: ${sektor || 'tidak diketahui'}

REKOD PERGERAKAN:
${contextLines || 'Tiada rekod dijumpai.'}

CARA MENJAWAB:
- Untuk pergerakan hari ini, gunakan hanya rekod bertarikh ${todayStr}
- Jika senarai orang: guna format "1. Nama berada di Destinasi (Tujuan)"
- Jika tiada rekod berpadanan: jawab dengan natural, contoh "Nampaknya tiada pegawai yang keluar hari ini!"
- Jangan reka atau andaikan data yang tiada dalam rekod`;

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
      dsReq.setTimeout(30000, () => {
        dsReq.destroy();
        sendJSON(res, 504, { error: 'Masa tamat menunggu respons DeepSeek.' });
      });
      dsReq.on('error', (e) => {
        if (!res.headersSent) sendJSON(res, 500, { error: `Ralat sambungan: ${e.message}` });
      });
      dsReq.write(deepseekBody);
      dsReq.end();
      return;
    }

    // Static files
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

// Initialize DB schema then start listening
initDb()
  .then(() => {
    purgeOldAuditLog();
    setInterval(purgeOldAuditLog, 24 * 60 * 60 * 1000);
    server.listen(PORT, () => {
      console.log(`e-Gerak PPD backend (PostgreSQL) listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Gagal menyambung ke PostgreSQL:', err.message);
    console.error('Pastikan DATABASE_URL dalam .env adalah betul dan PostgreSQL sedang berjalan.');
    process.exit(1);
  });

// Graceful shutdown untuk GCP Cloud Run (SIGTERM)
process.on('SIGTERM', () => {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
});
