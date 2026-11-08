// Ujian API e-Gerak. Perlu pelayan tempatan berjalan (npm start) dan DATABASE_URL tempatan.
// Jalankan: npm test   (BASE_URL lalai http://localhost:8118)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL)) {
  console.error('Ujian hanya boleh dijalankan pada pangkalan data tempatan (localhost). Dibatalkan.');
  process.exit(1);
}

const BASE = (process.env.BASE_URL || 'http://localhost:8118') + '/api';
const PIN = process.env.ADMIN_PIN;
const pool = new Pool({ connectionString: DB_URL });

const A = { email: 'ujian.satu@egerak.test', nama: 'UJIAN SATU BIN TEST', sektor: 'SPr' };
const B = { email: 'ujian.dua@egerak.test', nama: 'UJIAN DUA BINTI TEST', sektor: 'SPb' };
const TEST_IPS = ['192.0.2.10', '192.0.2.11'];

const shift = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const MON = shift(today, -((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7));
const [TUE, WED, THU] = [1, 2, 3].map(n => shift(MON, n));
// Dua minggu ke hadapan: sentiasa di luar julat isian auto (minggu depan diisi mulai Jumaat 5 petang)
const NEXT_WEEK = shift(MON, 16);

async function call(method, p, { body, headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const post = (who, rec) => call('POST', '/movements', {
  body: { nota: '', masa: '', sektor: who.sektor, nama: who.nama, submittedBy: who.email, ...rec } });
async function dayRows(who, tarikh) {
  const { rows } = await pool.query(
    `SELECT id, tujuan, destinasi, masa, submittedby FROM movements
     WHERE tarikh = $1 AND (submittedby = $2 OR UPPER(TRIM(nama)) = $3) ORDER BY id`, [tarikh, who.email, who.nama]);
  return rows;
}
const addAuto = (who, tarikh) => pool.query(
  `INSERT INTO movements (id,nama,tarikh,destinasi,tujuan,nota,masa,submittedby,sektor,created_at)
   VALUES ($1,$2,$3,'PPD Dalat','Berada di Pejabat','','','system',$4,$5) ON CONFLICT (id) DO NOTHING`,
  [`test-auto-${who.email}-${tarikh}`, who.nama, tarikh, who.sektor, new Date().toISOString()]);

async function cleanup() {
  await pool.query(`DELETE FROM movements WHERE submittedby = ANY($1) OR UPPER(TRIM(nama)) = ANY($2)`,
    [[A.email, B.email], [A.nama, B.nama, 'UJIAN SATU BARU']]);
  await pool.query(`DELETE FROM staff WHERE email = ANY($1)`, [[A.email, B.email]]);
  await pool.query(`DELETE FROM admin_login_attempts WHERE ip = ANY($1)`, [TEST_IPS]);
}

let adminToken;
before(async () => {
  await cleanup();
  for (const s of [A, B]) {
    await pool.query(`INSERT INTO staff (email, nama, jawatan, addedat, sektor) VALUES ($1,$2,'Ujian',$3,$4)`,
      [s.email, s.nama, new Date().toISOString(), s.sektor]);
  }
  const r = await call('POST', '/admin/verify', { body: { pin: PIN }, headers: { 'X-Forwarded-For': TEST_IPS[1] } });
  assert.ok(r.data && r.data.token, 'admin login failed — is the server running with the same ADMIN_PIN?');
  adminToken = r.data.token;
});

after(async () => {
  await call('POST', '/admin/logout', { headers: { 'X-Admin-Token': adminToken } });
  await cleanup();
  await pool.end();
});

test('submitting a movement replaces that day\'s auto record', async () => {
  await addAuto(A, TUE);
  const r = await post(A, { id: 'test-a-1', tarikh: TUE, destinasi: 'JPN Sarawak', tujuan: 'Kursus / Latihan', masa: '08:00 - 12:00' });
  assert.equal(r.status, 201);
  assert.deepEqual((await dayRows(A, TUE)).map(x => x.id), ['test-a-1']);
});

test('overlapping time asks first, replace swaps the record', async () => {
  let r = await post(A, { id: 'test-a-2', tarikh: TUE, destinasi: 'Kuching', tujuan: 'Bengkel Kerja', masa: '10:00 - 15:00' });
  assert.equal(r.status, 409);
  assert.equal(r.data.conflict, true);
  assert.deepEqual((await dayRows(A, TUE)).map(x => x.id), ['test-a-1']);

  r = await post(A, { id: 'test-a-2', tarikh: TUE, destinasi: 'Kuching', tujuan: 'Bengkel Kerja', masa: '10:00 - 15:00', replace: true });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.replaced, ['test-a-1']);
  assert.deepEqual((await dayRows(A, TUE)).map(x => x.id), ['test-a-2']);
});

test('back-to-back times and records without time do not clash', async () => {
  assert.equal((await post(A, { id: 'test-a-3', tarikh: TUE, destinasi: 'SK Mukah', tujuan: 'Pemantauan Sekolah', masa: '15:00 - 17:00' })).status, 201);
  assert.equal((await post(A, { id: 'test-a-4', tarikh: TUE, destinasi: 'PPD Dalat', tujuan: 'Mesyuarat / Perbincangan' })).status, 201);
});

test('deleting a record refills the empty weekday with Berada di Pejabat', async () => {
  await post(B, { id: 'test-b-1', tarikh: WED, destinasi: 'SK Kg Teh', tujuan: 'Program Prestij' });
  const r = await call('DELETE', `/movements/test-b-1?email=${encodeURIComponent(B.email)}`);
  assert.equal(r.status, 200);
  const rows = await dayRows(B, WED);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].submittedby, 'system');
});

test('whole-trip edit: shorten, move, and refill dropped days', async () => {
  for (const [i, d] of [WED, THU].entries()) {
    await call('DELETE', `/movements/test-auto-${A.email}-${d}`, { headers: { 'X-Admin-Token': adminToken } });
    assert.equal((await post(A, { id: `test-trip-${i}`, tarikh: d, destinasi: 'JPN Sarawak', tujuan: 'Kursus / Latihan', masa: '08:00 - 17:00' })).status, 201);
  }
  let r = await call('POST', `/movements/group-update?email=${encodeURIComponent(A.email)}`, {
    body: { ids: ['test-trip-0', 'test-trip-1'], tarikhMula: WED, tarikhAkhir: WED, destinasi: 'Kuching', tujuan: 'Kursus / Latihan', masa: '08:00 - 17:00' } });
  assert.equal(r.status, 200);
  assert.equal((await dayRows(A, WED))[0].destinasi, 'Kuching');
  const thu = await dayRows(A, THU);
  assert.equal(thu.length, 1);
  assert.equal(thu[0].submittedby, 'system');

  r = await call('POST', `/movements/group-update?email=${encodeURIComponent(B.email)}`, {
    body: { ids: ['test-trip-0'], tarikhMula: WED, tarikhAkhir: WED, destinasi: 'X', tujuan: 'Y' } });
  assert.equal(r.status, 403, 'another staff member must not edit the trip');
});

test('admin can edit a staff member\'s trip; auto records are not editable', async () => {
  let r = await call('POST', '/movements/group-update', { headers: { 'X-Admin-Token': adminToken },
    body: { ids: ['test-trip-0'], tarikhMula: WED, tarikhAkhir: WED, destinasi: 'Miri', tujuan: 'Kursus / Latihan', masa: '09:00 - 16:00' } });
  assert.equal(r.status, 200);
  assert.equal((await dayRows(A, WED))[0].destinasi, 'Miri');

  const auto = (await dayRows(A, THU))[0];
  r = await call('POST', '/movements/group-update', { headers: { 'X-Admin-Token': adminToken },
    body: { ids: [auto.id], tarikhMula: THU, tarikhAkhir: THU, destinasi: 'X', tujuan: 'Y' } });
  assert.equal(r.status, 400);
});

test('deleting a next-week record does not fill ahead of schedule', async () => {
  await post(B, { id: 'test-b-2', tarikh: NEXT_WEEK, destinasi: 'Kuching', tujuan: 'Bengkel Kerja' });
  await call('DELETE', `/movements/test-b-2?email=${encodeURIComponent(B.email)}`);
  assert.equal((await dayRows(B, NEXT_WEEK)).length, 0);
});

test('PIN lockout is per client IP and cannot be dodged with a fake X-Forwarded-For', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/admin/verify', { body: { pin: 'wrong' }, headers: { 'X-Forwarded-For': TEST_IPS[0] } });
  let r = await call('POST', '/admin/verify', { body: { pin: PIN }, headers: { 'X-Forwarded-For': TEST_IPS[0] } });
  assert.equal(r.status, 429);
  r = await call('POST', '/admin/verify', { body: { pin: PIN }, headers: { 'X-Forwarded-For': `1.2.3.4, ${TEST_IPS[0]}` } });
  assert.equal(r.status, 429);
});

test('admin PIN is not accepted as a header', async () => {
  assert.equal((await call('GET', '/movements', { headers: { 'X-Admin-Pin': PIN } })).status, 401);
  assert.equal((await call('GET', '/admin/staff', { headers: { 'X-Admin-Pin': PIN } })).status, 403);
});

test('deactivating staff blocks login but keeps history; reactivating restores it', async () => {
  assert.equal((await post(B, { id: 'test-b-hist', tarikh: MON, destinasi: 'SK Batu Niah', tujuan: 'Pemantauan Sekolah' })).status, 201);
  let r = await call('DELETE', `/admin/staff/${encodeURIComponent(B.email)}`, { headers: { 'X-Admin-Token': adminToken } });
  assert.equal(r.status, 200);
  r = await call('GET', `/staff/check?email=${encodeURIComponent(B.email)}`);
  assert.equal(r.data.deactivated, true);
  assert.equal((await call('GET', `/movements?email=${encodeURIComponent(B.email)}`)).status, 401);
  assert.ok((await dayRows(B, MON)).some(x => x.id === 'test-b-hist'), 'history must be kept');

  r = await call('POST', `/admin/staff/${encodeURIComponent(B.email)}/reactivate`, { headers: { 'X-Admin-Token': adminToken } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/staff/check?email=${encodeURIComponent(B.email)}`)).data.allowed, true);
});

test('renaming staff in Urus renames their records too', async () => {
  const r = await call('POST', '/admin/staff', { headers: { 'X-Admin-Token': adminToken },
    body: { email: A.email, nama: 'Ujian Satu Baru', jawatan: 'Ujian', sektor: 'SPr' } });
  assert.equal(r.status, 201);
  const { rows } = await pool.query(`SELECT DISTINCT nama FROM movements WHERE submittedby = $1`, [A.email]);
  assert.deepEqual(rows.map(x => x.nama), ['UJIAN SATU BARU']);
});

// --- Sektor & nama rekod sentiasa ikut jadual staf (elak rekod tersalah sektor seperti "SPP/SPsK") ---
const OLD_DAY = shift(MON, -10);

test('a record takes its sector and name from the staff roster, not from the browser', async () => {
  const r = await post(B, { id: 'test-sektor-1', tarikh: OLD_DAY, destinasi: 'SK Dalat', tujuan: 'Pemantauan Sekolah',
    sektor: 'SPP/SPsK', nama: 'Puan Ujian Dua Binti Test' });
  assert.equal(r.status, 201);
  const { rows } = await pool.query(`SELECT nama, sektor FROM movements WHERE id = 'test-sektor-1'`);
  assert.deepEqual(rows[0], { nama: B.nama, sektor: B.sektor });
});

test('admin changing a staff member\'s sector moves all their records; combined sectors are refused', async () => {
  const H = { 'X-Admin-Token': adminToken };
  const bad = await call('PATCH', `/admin/staff/${encodeURIComponent(B.email)}/sektor`, { headers: H, body: { sektor: 'SPP/SPsK' } });
  assert.equal(bad.status, 400);
  const r = await call('PATCH', `/admin/staff/${encodeURIComponent(B.email)}/sektor`, { headers: H, body: { sektor: 'SPsK' } });
  assert.equal(r.status, 200);
  const { rows } = await pool.query(`SELECT DISTINCT sektor FROM movements WHERE submittedby = $1`, [B.email]);
  assert.deepEqual(rows.map(x => x.sektor), ['SPsK']);
  await call('PATCH', `/admin/staff/${encodeURIComponent(B.email)}/sektor`, { headers: H, body: { sektor: B.sektor } });
});

test('titles such as Encik, Puan and Dr are removed from staff names', async () => {
  const r = await call('POST', '/admin/staff', { headers: { 'X-Admin-Token': adminToken },
    body: { email: B.email, nama: 'Dr. Hjh. Ujian Dua Binti Test', jawatan: 'Ujian', sektor: B.sektor } });
  assert.equal(r.status, 201);
  const { rows } = await pool.query(`SELECT nama FROM staff WHERE email = $1`, [B.email]);
  assert.equal(rows[0].nama, B.nama);
});
