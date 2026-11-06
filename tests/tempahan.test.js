// Ujian e-Tempahan. Perlu pelayan tempatan berjalan (npm start) dan DATABASE_URL tempatan.
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

const ORIGIN = process.env.BASE_URL || 'http://localhost:8118';
const BASE = ORIGIN + '/api';
const pool = new Pool({ connectionString: DB_URL });
const A = { email: 'tp.satu@egerak.test', nama: 'UJIAN TEMPAHAN SATU', sektor: 'SPr' };
const B = { email: 'tp.dua@egerak.test', nama: 'UJIAN TEMPAHAN DUA', sektor: 'SPb' };
const TEST_IP = '192.0.2.20';

const shift = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const D1 = shift(today, 3);
const D2 = shift(today, 4);

async function call(method, p, { body, headers = {} } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const as = who => ({
  book: b => call('POST', '/tempahan', { body: { email: who.email, ...b } }),
  semak: b => call('POST', '/tempahan/semak', { body: { email: who.email, ...b } }),
  patch: (id, b) => call('PATCH', `/tempahan/${id}?email=${encodeURIComponent(who.email)}`, { body: b }),
  batal: id => call('POST', `/tempahan/${id}/batal?email=${encodeURIComponent(who.email)}`, { body: {} }),
  week: () => call('GET', `/tempahan?from=${D1}&to=${D2}&email=${encodeURIComponent(who.email)}`),
  mine: () => call('GET', `/tempahan/saya?email=${encodeURIComponent(who.email)}`),
});

let H, van, hilux, bilik;
async function cleanup() {
  await pool.query(`DELETE FROM tempahan WHERE email = ANY($1) OR aset_id IN (SELECT id FROM aset WHERE nama LIKE 'UJIAN-TP %')`, [[A.email, B.email]]);
  await pool.query(`DELETE FROM aset WHERE nama LIKE 'UJIAN-TP %'`);
  await pool.query(`DELETE FROM staff WHERE email = ANY($1)`, [[A.email, B.email]]);
  await pool.query(`DELETE FROM admin_login_attempts WHERE ip = $1`, [TEST_IP]);
}

before(async () => {
  await cleanup();
  for (const s of [A, B]) {
    await pool.query(`INSERT INTO staff (email, nama, jawatan, addedat, sektor) VALUES ($1,$2,'Ujian',$3,$4)`,
      [s.email, s.nama, new Date().toISOString(), s.sektor]);
  }
  const r = await call('POST', '/admin/verify', { body: { pin: process.env.ADMIN_PIN }, headers: { 'X-Forwarded-For': TEST_IP } });
  assert.ok(r.data && r.data.token, 'admin login failed');
  H = { 'X-Admin-Token': r.data.token };
  for (const a of [
    { jenis: 'kenderaan', nama: 'UJIAN-TP Van', kapasiti: 10 },
    { jenis: 'kenderaan', nama: 'UJIAN-TP Hilux', kapasiti: 4 },
    { jenis: 'bilik', nama: 'UJIAN-TP Bilik', kapasiti: 20 },
  ]) assert.equal((await call('POST', '/admin/aset', { body: a, headers: H })).status, 201);
  const list = (await call('GET', '/admin/aset', { headers: H })).data;
  [van, hilux, bilik] = ['UJIAN-TP Van', 'UJIAN-TP Hilux', 'UJIAN-TP Bilik'].map(n => list.find(a => a.nama === n));
});

after(async () => {
  await call('POST', '/admin/logout', { headers: H });
  await cleanup();
  await pool.end();
});

test('booking a free slot is confirmed immediately', async () => {
  const r = await as(A).book({ aset_id: van.id, mula: `${D1}T08:00`, tamat: `${D1}T17:00`, tujuan: 'Lawatan sekolah', destinasi: 'Mukah', penumpang: 4 });
  assert.equal(r.status, 201);
  assert.ok(r.data.id);
});

test('overlapping booking is refused with alternatives', async () => {
  const r = await as(B).book({ aset_id: van.id, mula: `${D1}T10:00`, tamat: `${D1}T12:00`, tujuan: 'Mesyuarat' });
  assert.equal(r.status, 409);
  assert.equal(r.data.conflict, true);
  assert.equal(r.data.bertindih[0].nama, A.nama);
  assert.ok(r.data.cadangan.aset_lain.some(a => a.id === hilux.id), 'should suggest the other vehicle');
  assert.deepEqual(r.data.cadangan.slot_seterusnya, { mula: `${D1}T17:00`, tamat: `${D1}T19:00` });
});

test('back-to-back bookings are allowed', async () => {
  const r = await as(B).book({ aset_id: van.id, mula: `${D1}T17:00`, tamat: `${D1}T19:00`, tujuan: 'Program malam' });
  assert.equal(r.status, 201);
});

test('check-only endpoint reports availability without saving', async () => {
  const busy = await as(B).semak({ aset_id: van.id, mula: `${D1}T09:00`, tamat: `${D1}T10:00`, tujuan: 'X' });
  assert.equal(busy.data.tersedia, false);
  const free = await as(B).semak({ aset_id: hilux.id, mula: `${D1}T09:00`, tamat: `${D1}T10:00`, tujuan: 'X' });
  assert.equal(free.data.tersedia, true);
  assert.equal((await as(B).mine()).data.filter(t => t.aset_id === hilux.id).length, 0);
});

test('rules: end after start, not in the past, within 60 days, within capacity', async () => {
  const base = { aset_id: hilux.id, tujuan: 'X' };
  assert.equal((await as(A).book({ ...base, mula: `${D1}T10:00`, tamat: `${D1}T09:00` })).status, 400);
  assert.equal((await as(A).book({ ...base, mula: `${shift(today, -2)}T10:00`, tamat: `${shift(today, -2)}T11:00` })).status, 400);
  assert.equal((await as(A).book({ ...base, mula: `${shift(today, 70)}T10:00`, tamat: `${shift(today, 70)}T11:00` })).status, 400);
  assert.equal((await as(A).book({ ...base, mula: `${D2}T10:00`, tamat: `${D2}T11:00`, penumpang: 9 })).status, 400);
  assert.equal((await as(A).book({ ...base, mula: `${D2}T10:00`, tamat: `${D2}T11:00`, tujuan: '' })).status, 400);
});

test('calendar shows name and sector but never e-mails, and marks own bookings', async () => {
  const r = await as(B).week();
  assert.equal(r.status, 200);
  const vanRows = r.data.filter(t => t.aset_id === van.id);
  assert.equal(vanRows.length, 2);
  assert.ok(vanRows.every(t => !('email' in t)));
  assert.deepEqual(vanRows.map(t => t.milik_saya).sort(), [false, true]);
});

test('only the owner can change or cancel; changes re-check clashes', async () => {
  const own = (await as(A).mine()).data.find(t => t.aset_id === van.id);
  assert.equal((await as(B).batal(own.id)).status, 404);
  assert.equal((await as(B).patch(own.id, { aset_id: van.id, mula: `${D2}T08:00`, tamat: `${D2}T09:00`, tujuan: 'X' })).status, 404);

  const clash = await as(A).patch(own.id, { aset_id: van.id, mula: `${D1}T16:00`, tamat: `${D1}T18:00`, tujuan: 'X' });
  assert.equal(clash.status, 409, 'moving into B\'s 17:00 slot must clash');

  const moved = await as(A).patch(own.id, { aset_id: van.id, mula: `${D2}T08:00`, tamat: `${D2}T17:00`, tujuan: 'Lawatan sekolah', destinasi: 'Mukah' });
  assert.equal(moved.status, 200);
  assert.equal((await as(B).book({ aset_id: van.id, mula: `${D1}T09:00`, tamat: `${D1}T12:00`, tujuan: 'Kini kosong' })).status, 201);

  assert.equal((await as(A).batal(own.id)).status, 200);
  assert.equal((await as(B).book({ aset_id: van.id, mula: `${D2}T09:00`, tamat: `${D2}T10:00`, tujuan: 'Slot dibatalkan' })).status, 201);
});

test('asset under maintenance cannot be booked; owners are counted for notice', async () => {
  assert.equal((await as(A).book({ aset_id: bilik.id, mula: `${D2}T14:00`, tamat: `${D2}T16:00`, tujuan: 'Mesyuarat' })).status, 201);
  const r = await call('PATCH', `/admin/aset/${bilik.id}/status`, { body: { status: 'penyelenggaraan' }, headers: H });
  assert.equal(r.status, 200);
  assert.equal(r.data.terjejas, 1);
  assert.equal((await as(B).book({ aset_id: bilik.id, mula: `${D2}T08:00`, tamat: `${D2}T09:00`, tujuan: 'X' })).status, 400);
  const mine = (await as(A).mine()).data.find(t => t.aset_id === bilik.id);
  assert.equal(mine.aset_status, 'penyelenggaraan', 'booking stays, with a warning');

  await call('PATCH', `/admin/aset/${bilik.id}/status`, { body: { status: 'tidak_aktif' }, headers: H });
  const visible = (await call('GET', `/aset?email=${encodeURIComponent(A.email)}`)).data;
  assert.ok(!visible.some(a => a.id === bilik.id), 'inactive assets are hidden from staff');
});

test('booking endpoints need a staff account', async () => {
  assert.equal((await call('GET', '/aset')).status, 401);
  assert.equal((await call('POST', '/tempahan', { body: { email: 'orang.luar@contoh.com', aset_id: van.id } })).status, 401);
  assert.equal((await call('POST', '/tempahan/parse', { body: { email: A.email, message: '' } })).status, 400);
});

test('server only serves the app\'s own files', async () => {
  for (const p of ['/.env', '/server/server.js', '/package.json', '/demo_akaun.txt', '/icons/../.env', '/%2e%2e/.env']) {
    assert.equal((await fetch(ORIGIN + p)).status, 404, p);
  }
  for (const p of ['/', '/index.html', '/tempahan.js', '/sw.js', '/manifest.json', '/icons/icon-192.png']) {
    assert.equal((await fetch(ORIGIN + p)).status, 200, p);
  }
});
