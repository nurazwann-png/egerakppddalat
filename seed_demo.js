/**
 * seed_demo.js — Populate demo database with realistic dummy data
 * Jun–Ogos 2025 usage pattern:
 *   Jun: sedikit (baru launch)
 *   Jul: sederhana
 *   Ogos: penuh (semua pengguna aktif)
 *
 * Run: DATABASE_URL=<demo_db_url> node seed_demo.js
 */

require('dotenv').config({ path: '.env.demo' });
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Staff data (all 49) ───────────────────────────────────────────────────
const STAFF = [
  // SPr
  { email: 'andrian.lang@ppddalat.edu.my',      nama: 'ANDRIAN BIN LANG',                    jawatan: 'Timbalan PPD',               sektor: 'SPr' },
  { email: 'johan.senen@ppddalat.edu.my',        nama: 'JOHAN BIN SENEN',                     jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPr' },
  { email: 'nurazwann.ismail@ppddalat.edu.my',   nama: 'NURAZWANN BIN ISMAIL',                jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPr' },
  // SPb
  { email: 'aiphonsus.lang@ppddalat.edu.my',     nama: 'AIPHONSUS BIN LANG',                  jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'ajibah.melahi@ppddalat.edu.my',      nama: 'AJIBAH BINTI MELAHI',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'christina.phoa@ppddalat.edu.my',     nama: 'CHRISTINA PHOA',                      jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'erik.dan@ppddalat.edu.my',           nama: 'ERIK BIN DAN',                        jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'faridah.jahori@ppddalat.edu.my',     nama: 'FARIDAH BINTI JAHORI',                jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'kamsiah.uki@ppddalat.edu.my',        nama: 'KAMSIAH BINTI UKI',                   jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'nujaimi.kaman@ppddalat.edu.my',      nama: 'NUJAIMI BIN KAMAN',                   jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'rahanah.bana@ppddalat.edu.my',       nama: 'RAHANAH BINTI BANA',                  jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  // SPbM
  { email: 'mathew.muhan@ppddalat.edu.my',       nama: 'MATHEW MUHAN BIN KUSANG',             jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
  { email: 'syukmar.japar@ppddalat.edu.my',      nama: 'SYUKMAR BIN JAPAR',                   jawatan: 'Pembantu Tadbir',            sektor: 'SPbM' },
  { email: 'hasbiee.amit@ppddalat.edu.my',       nama: 'HASBIEE BIN AMIT',                    jawatan: 'Timbalan PPD',               sektor: 'SPbM' },
  { email: 'nursherrima.baharim@ppddalat.edu.my',nama: 'NUR SHERRIMA BINTI BAHARIM',          jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
  { email: 'naraida.mudah@ppddalat.edu.my',      nama: 'NARAIDA BINTI MUDAH',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
  // SP
  { email: 'arni.gunong@ppddalat.edu.my',        nama: 'ARNI BINTI GUNONG MORISON',           jawatan: 'Penolong Pegawai Tadbir',    sektor: 'SP' },
  { email: 'azlan.mohamad@ppddalat.edu.my',      nama: 'AZLAN BIN MOHAMAD',                   jawatan: 'Penolong Akauntan',          sektor: 'SP' },
  { email: 'christine.lolly@ppddalat.edu.my',    nama: 'CHRISTINE LOLLY ANAK ANTHONY',        jawatan: 'Pembantu Tadbir',            sektor: 'SP' },
  { email: 'dayang.maslemah@ppddalat.edu.my',    nama: 'DAYANG MASLEMAH BINTI AWANG USUP',    jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'evelyne.boniface@ppddalat.edu.my',   nama: 'EVELYNE BINTI BONIFACE GUANG',        jawatan: 'Pembantu Tadbir',            sektor: 'SP' },
  { email: 'fauziah.fauzi@ppddalat.edu.my',      nama: 'FAUZIAH BINTI FAUZI',                 jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'jamalia.mawi@ppddalat.edu.my',       nama: 'JAMALIA BINTI MAWI',                  jawatan: 'Pembantu Tadbir',            sektor: 'SP' },
  { email: 'josielin.kubang@ppddalat.edu.my',    nama: 'JOSIELIN BINTI KUBANG',               jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'lanida.devies@ppddalat.edu.my',      nama: 'LANIDA ANAK DEVIES',                  jawatan: 'Penolong Pegawai Tadbir',    sektor: 'SP' },
  { email: 'mohd.haffis@ppddalat.edu.my',        nama: 'MOHD. HAFFIS BIN JAPAR',              jawatan: 'Juruteknik Komputer',        sektor: 'SP' },
  { email: 'noraini.amit@ppddalat.edu.my',       nama: 'NORAINI BINTI AMIT',                  jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'nurqistina.johini@ppddalat.edu.my',  nama: 'NURQISTINA BALQIS BINTI JOHINI',      jawatan: 'Pembantu Akauntan',          sektor: 'SP' },
  { email: 'nurrahman.moris@ppddalat.edu.my',    nama: 'NUR RAHMAN BIN MORIS',                jawatan: 'Pembantu Khidmat Am',        sektor: 'SP' },
  { email: 'reta.jalani@ppddalat.edu.my',        nama: 'RETA BINTI JALANI',                   jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'reynilda.jite@ppddalat.edu.my',      nama: 'REYNILDA BINTI JITE',                 jawatan: 'Pembantu Tadbir(P/O)',       sektor: 'SP' },
  { email: 'zainab.nen@ppddalat.edu.my',         nama: 'ZAINAB BINTI NEN',                    jawatan: 'Pembantu Tadbir',            sektor: 'SP' },
  // SPS
  { email: 'angelia.batan@ppddalat.edu.my',      nama: 'ANGELIA BINTI NICHOLAS BATAN',        jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'eduine.kusai@ppddalat.edu.my',       nama: 'EDUINE BIN KUSAI',                    jawatan: 'Timbalan PPD',               sektor: 'SPS' },
  { email: 'haneem.hosman@ppddalat.edu.my',      nama: 'HANEEM BINTI HOSMAN',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'lisa.pey@ppddalat.edu.my',           nama: 'LISA DEBRA PEY ADUM',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'mohamad.sahrin@ppddalat.edu.my',     nama: 'MOHAMAD SAHRIN BIN SULAIMAN',         jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'nonita.jidi@ppddalat.edu.my',        nama: 'NONITA BINTI MOHAMAD JIDI',           jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'sahran.sahren@ppddalat.edu.my',      nama: 'SAHRAN BIN SAHREN',                   jawatan: 'Pembantu Tadbir',            sektor: 'SPS' },
  { email: 'tan.miangseng@ppddalat.edu.my',      nama: 'TAN MIANG SENG',                      jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  // SPP/SPsK
  { email: 'loo.ahsing@ppddalat.edu.my',         nama: 'LOO AH SING',                         jawatan: 'Kaunselor Pendidikan',       sektor: 'SPP/SPsK' },
  { email: 'johari.moshidi@ppddalat.edu.my',     nama: 'JOHARI BIN MOSHIDI',                  jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPP/SPsK' },
  { email: 'kettlin.ason@ppddalat.edu.my',       nama: 'KETTLIN SAFIYA BINTI ASON',           jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPP/SPsK' },
  // PTIS
  { email: 'amriee.yusup@ppddalat.edu.my',       nama: 'AMRIEE BIN YUSUP',                    jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'iswandy.ho@ppddalat.edu.my',         nama: 'ISWANDY HO BIN AHMAD HO',             jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'mohammad.tawfik@ppddalat.edu.my',    nama: 'MOHAMMAD TAWFIK BIN HAMBALI',         jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'ruqayyah.sedaka@ppddalat.edu.my',    nama: 'RUQAYYAH BINTI AL SEDAKA',            jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'vincent.asam@ppddalat.edu.my',       nama: 'VINCENT BIN ANTHONY ASAM',            jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'zaimayani.drahman@ppddalat.edu.my',  nama: 'ZAIMAYANI BINTI DRAHMAN BUJANG',      jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
];

// ── Movement templates ────────────────────────────────────────────────────
const DESTINATIONS = [
  'SMK Dalat', 'SMK Oya', 'SK Sg. Maw', 'SK Balingian', 'SK Igan',
  'SK Dalat', 'SMK Balingian', 'SK Sg. Lau', 'SK Bilal', 'SK Abang Galau',
  'JPN Sarawak, Kuching', 'JPN Sarawak, Miri', 'PPD Mukah', 'Wisma Bapa Malaysia',
  'Institut Aminuddin Baki (IAB)', 'Hotel Grand Merdeka Mukah',
  'Dewan Suarah Mukah', 'Kompleks Sukan Mukah', 'Pejabat Daerah Mukah',
  'Pejabat Pendidikan Daerah Mukah', 'Pejabat PPD Dalat',
];

const TUJUANS = [
  { t: 'Pemantauan Sekolah',        sektors: ['SPb', 'SPbM', 'SPS', 'SPr'] },
  { t: 'Mesyuarat / Perbincangan',  sektors: ['SPr', 'SP', 'SPS', 'SPbM', 'SPb', 'SPP/SPsK'] },
  { t: 'Kursus / Latihan',          sektors: ['SPb', 'SPS', 'SPbM', 'PTIS', 'SP'] },
  { t: 'Bengkel Kerja',             sektors: ['SPb', 'SPS', 'SPbM', 'SPr', 'SPP/SPsK'] },
  { t: 'Tugas Rasmi Lain',          sektors: ['SP', 'PTIS', 'SPr', 'SPS'] },
  { t: 'Berada di Pejabat',         sektors: ['SP', 'PTIS', 'SPP/SPsK'] },
  { t: 'Cuti Rehat / Cuti Sakit',   sektors: null }, // any
  { t: 'Kebenaran Keluar Pejabat',  sektors: null },
];

const MASA_PAIRS = [
  { bertolak: '07:30', balik: '17:00' },
  { bertolak: '08:00', balik: '17:00' },
  { bertolak: '08:00', balik: '13:00' },
  { bertolak: '09:00', balik: '17:00' },
  { bertolak: '10:00', balik: '16:00' },
  { bertolak: '07:30', balik: '13:00' },
  { bertolak: '', balik: '' }, // no time (full-day / cuti)
];

// ── Helpers ───────────────────────────────────────────────────────────────
function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function uid() { return crypto.randomBytes(8).toString('hex'); }

function malaysiaDateStr(d) {
  const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 10);
}

function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function isPublicHoliday(ds) {
  // Major Malaysian/Sarawak public holidays in Jun–Aug 2025
  return ['2025-06-02', '2025-07-07', '2025-08-01', '2025-08-31'].includes(ds);
}

function pickTujuan(sektor) {
  const relevant = TUJUANS.filter(t => !t.sektors || t.sektors.includes(sektor));
  return rnd(relevant).t;
}

function pickDest(tujuan, sektor) {
  if (tujuan === 'Berada di Pejabat') return 'Pejabat PPD Dalat';
  if (tujuan === 'Kebenaran Keluar Pejabat') return rnd(['Mukah', 'Sibu', 'Kuching', 'Klinik', 'Bank', 'Pejabat Pos']);
  if (tujuan === 'Cuti Rehat / Cuti Sakit') return 'Pejabat PPD Dalat';
  if (['SPb', 'SPS', 'SPbM'].includes(sektor) && tujuan === 'Pemantauan Sekolah') {
    return rnd(DESTINATIONS.filter(d => d.startsWith('SM') || d.startsWith('SK')));
  }
  return rnd(DESTINATIONS);
}

function makeRecord(staff, dateStr, nota = '') {
  const tujuan = pickTujuan(staff.sektor);
  const dest = pickDest(tujuan, staff.sektor);
  const masa = rnd(MASA_PAIRS);
  const createdAt = new Date(dateStr + 'T07:00:00+08:00').toISOString();
  return {
    id: uid(),
    nama: staff.nama,
    tarikh: dateStr,
    destinasi: dest,
    tujuan,
    nota,
    masa: masa.bertolak,
    masa_balik: masa.balik,
    submittedby: staff.email,
    sektor: staff.sektor,
    created_at: createdAt,
  };
}

// ── Generate movements by month ────────────────────────────────────────────
function generateMovements() {
  const records = [];
  const start = new Date('2025-06-01T00:00:00Z');
  const end   = new Date('2025-08-19T00:00:00Z');

  // For each working day, decide who submits
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = malaysiaDateStr(d);
    if (isWeekend(d) || isPublicHoliday(ds)) continue;

    const month = d.getMonth() + 1; // 6=Jun, 7=Jul, 8=Ogos

    // Determine participation rate per month
    // Jun: 20-35% staff (baru launch, hanya beberapa sektor)
    // Jul: 50-70% staff (sederhana, makin ramai tahu)
    // Aug: 80-100% staff (semua pengguna aktif)
    let rate, activeSektors;
    if (month === 6) {
      // Only SPr, SPb, SPbM early adopters in June
      activeSektors = ['SPr', 'SPb', 'SPbM'];
      rate = 0.6; // 60% of those 3 sectors
    } else if (month === 7) {
      activeSektors = ['SPr', 'SPb', 'SPbM', 'SPS', 'SP'];
      rate = 0.65;
    } else {
      activeSektors = null; // all sektors
      rate = 0.88;
    }

    const pool_ = activeSektors
      ? STAFF.filter(s => activeSektors.includes(s.sektor))
      : STAFF;

    // Shuffle and pick
    const shuffled = [...pool_].sort(() => Math.random() - 0.5);
    const count = Math.ceil(shuffled.length * rate);
    const today = shuffled.slice(0, count);

    for (const staff of today) {
      // Some staff submit 2 records (morning + afternoon dest)
      const multi = Math.random() < 0.15 && month >= 7;
      records.push(makeRecord(staff, ds));
      if (multi) {
        records.push(makeRecord(staff, ds, 'Perjalanan ke-2'));
      }
    }
  }

  return records;
}

// ── Seed DB ────────────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  try {
    console.log('Creating tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS movements (
        id TEXT PRIMARY KEY,
        nama TEXT NOT NULL,
        tarikh TEXT NOT NULL,
        destinasi TEXT NOT NULL,
        tujuan TEXT NOT NULL,
        nota TEXT DEFAULT '',
        masa TEXT DEFAULT '',
        submittedby TEXT DEFAULT '',
        sektor TEXT DEFAULT 'SPr',
        push_sent_at TEXT,
        created_at TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff (
        email TEXT PRIMARY KEY,
        nama TEXT NOT NULL,
        jawatan TEXT NOT NULL,
        sektor TEXT DEFAULT 'SPr'
      )
    `);
    await client.query(`CREATE TABLE IF NOT EXISTS jawatan_list (jawatan TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL, ts TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, tajuk TEXT NOT NULL, isi TEXT NOT NULL, ts TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at TEXT NOT NULL)`);

    // Clear existing
    console.log('Clearing existing data...');
    await client.query('DELETE FROM movements');
    await client.query('DELETE FROM staff');

    // Insert staff
    console.log(`Inserting ${STAFF.length} staff...`);
    for (const s of STAFF) {
      await client.query(
        'INSERT INTO staff (email, nama, jawatan, sektor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [s.email, s.nama, s.jawatan, s.sektor]
      );
    }

    // Insert jawatan
    const jawatans = [...new Set(STAFF.map(s => s.jawatan))];
    for (const j of jawatans) {
      await client.query('INSERT INTO jawatan_list (jawatan) VALUES ($1) ON CONFLICT DO NOTHING', [j]);
    }

    // Generate & insert movements
    console.log('Generating movements...');
    const movements = generateMovements();
    console.log(`Inserting ${movements.length} movement records...`);

    for (const m of movements) {
      await client.query(
        `INSERT INTO movements (id,nama,tarikh,destinasi,tujuan,nota,masa,submittedby,sektor,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [m.id, m.nama, m.tarikh, m.destinasi, m.tujuan, m.nota, m.masa, m.submittedby, m.sektor, m.created_at]
      );
    }

    // Add welcome notice
    await client.query(
      `INSERT INTO notices (id,tajuk,isi,ts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), 'Selamat Datang ke e-Gerak PPD Dalat!',
       'Sistem e-Gerak PPD Dalat kini telah dilancarkan secara rasmi. Sila daftarkan pergerakan harian anda melalui sistem ini. Sebarang pertanyaan, sila hubungi Sektor Perancangan.',
       '2025-06-02T08:00:00.000Z']
    );
    await client.query(
      `INSERT INTO notices (id,tajuk,isi,ts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), 'Peringatan: Rekod Pergerakan Wajib Dikemas Kini',
       'Semua pegawai diwajibkan merekod pergerakan harian dalam sistem e-Gerak. Pastikan rekod dikemas kini setiap hari bekerja. Terima kasih atas kerjasama anda.',
       '2025-07-07T08:00:00.000Z']
    );

    // Summary
    const { rows: byMonth } = await client.query(
      `SELECT SUBSTRING(tarikh,1,7) AS bulan, COUNT(*) AS jumlah FROM movements GROUP BY bulan ORDER BY bulan`
    );
    console.log('\n✅ Seed berjaya!\n');
    console.log('Rekod mengikut bulan:');
    byMonth.forEach(r => console.log(`  ${r.bulan}: ${r.jumlah} rekod`));
    console.log(`\nJumlah staf: ${STAFF.length}`);
    console.log(`Jumlah rekod: ${movements.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
