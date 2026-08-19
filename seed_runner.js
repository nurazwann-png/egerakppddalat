/**
 * seed_runner.js — Cloud Run Job entry point.
 * Runs seed_demo.js logic using Cloud SQL Unix socket connection.
 * Deploy as a Cloud Run Job and execute once.
 */
const { Pool } = require('pg');
const crypto = require('crypto');

const instanceConnectionName = process.env.INSTANCE_CONNECTION_NAME;

const pool = instanceConnectionName
  ? new Pool({
      host: `/cloudsql/${instanceConnectionName}`,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'egerak_demo',
      port: 5432,
    })
  : new Pool({ connectionString: process.env.DATABASE_URL });

// ── Staff data (all 49) ───────────────────────────────────────────────────
const STAFF = [
  { email: 'andrian.lang@ppddalat.edu.my',      nama: 'ANDRIAN BIN LANG',                    jawatan: 'Timbalan PPD',               sektor: 'SPr' },
  { email: 'johan.senen@ppddalat.edu.my',        nama: 'JOHAN BIN SENEN',                     jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPr' },
  { email: 'nurazwann.ismail@ppddalat.edu.my',   nama: 'NURAZWANN BIN ISMAIL',                jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPr' },
  { email: 'aiphonsus.lang@ppddalat.edu.my',     nama: 'AIPHONSUS BIN LANG',                  jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'ajibah.melahi@ppddalat.edu.my',      nama: 'AJIBAH BINTI MELAHI',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'christina.phoa@ppddalat.edu.my',     nama: 'CHRISTINA PHOA',                      jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'erik.dan@ppddalat.edu.my',           nama: 'ERIK BIN DAN',                        jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'faridah.jahori@ppddalat.edu.my',     nama: 'FARIDAH BINTI JAHORI',                jawatan: 'SISC+',                      sektor: 'SPb' },
  { email: 'kamsiah.uki@ppddalat.edu.my',        nama: 'KAMSIAH BINTI UKI',                   jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'nujaimi.kaman@ppddalat.edu.my',      nama: 'NUJAIMI BIN KAMAN',                   jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'rahanah.bana@ppddalat.edu.my',       nama: 'RAHANAH BINTI BANA',                  jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPb' },
  { email: 'mathew.muhan@ppddalat.edu.my',       nama: 'MATHEW MUHAN BIN KUSANG',             jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
  { email: 'syukmar.japar@ppddalat.edu.my',      nama: 'SYUKMAR BIN JAPAR',                   jawatan: 'Pembantu Tadbir',            sektor: 'SPbM' },
  { email: 'hasbiee.amit@ppddalat.edu.my',       nama: 'HASBIEE BIN AMIT',                    jawatan: 'Timbalan PPD',               sektor: 'SPbM' },
  { email: 'nursherrima.baharim@ppddalat.edu.my',nama: 'NUR SHERRIMA BINTI BAHARIM',          jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
  { email: 'naraida.mudah@ppddalat.edu.my',      nama: 'NARAIDA BINTI MUDAH',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPbM' },
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
  { email: 'angelia.batan@ppddalat.edu.my',      nama: 'ANGELIA BINTI NICHOLAS BATAN',        jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'eduine.kusai@ppddalat.edu.my',       nama: 'EDUINE BIN KUSAI',                    jawatan: 'Timbalan PPD',               sektor: 'SPS' },
  { email: 'haneem.hosman@ppddalat.edu.my',      nama: 'HANEEM BINTI HOSMAN',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'lisa.pey@ppddalat.edu.my',           nama: 'LISA DEBRA PEY ADUM',                 jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'mohamad.sahrin@ppddalat.edu.my',     nama: 'MOHAMAD SAHRIN BIN SULAIMAN',         jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'nonita.jidi@ppddalat.edu.my',        nama: 'NONITA BINTI MOHAMAD JIDI',           jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'sahran.sahren@ppddalat.edu.my',      nama: 'SAHRAN BIN SAHREN',                   jawatan: 'Pembantu Tadbir',            sektor: 'SPS' },
  { email: 'tan.miangseng@ppddalat.edu.my',      nama: 'TAN MIANG SENG',                      jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPS' },
  { email: 'loo.ahsing@ppddalat.edu.my',         nama: 'LOO AH SING',                         jawatan: 'Kaunselor Pendidikan',       sektor: 'SPP/SPsK' },
  { email: 'johari.moshidi@ppddalat.edu.my',     nama: 'JOHARI BIN MOSHIDI',                  jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPP/SPsK' },
  { email: 'kettlin.ason@ppddalat.edu.my',       nama: 'KETTLIN SAFIYA BINTI ASON',           jawatan: 'Penolong Pegawai Pendidikan', sektor: 'SPP/SPsK' },
  { email: 'amriee.yusup@ppddalat.edu.my',       nama: 'AMRIEE BIN YUSUP',                    jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'iswandy.ho@ppddalat.edu.my',         nama: 'ISWANDY HO BIN AHMAD HO',             jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'mohammad.tawfik@ppddalat.edu.my',    nama: 'MOHAMMAD TAWFIK BIN HAMBALI',         jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'ruqayyah.sedaka@ppddalat.edu.my',    nama: 'RUQAYYAH BINTI AL SEDAKA',            jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'vincent.asam@ppddalat.edu.my',       nama: 'VINCENT BIN ANTHONY ASAM',            jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
  { email: 'zaimayani.drahman@ppddalat.edu.my',  nama: 'ZAIMAYANI BINTI DRAHMAN BUJANG',      jawatan: 'Juruteknik Komputer',        sektor: 'PTIS' },
];

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
  { t: 'Cuti Rehat / Cuti Sakit',   sektors: null },
  { t: 'Kebenaran Keluar Pejabat',  sektors: null },
];

const MASA_PAIRS = [
  { bertolak: '07:30', balik: '17:00' },
  { bertolak: '08:00', balik: '17:00' },
  { bertolak: '08:00', balik: '13:00' },
  { bertolak: '09:00', balik: '17:00' },
  { bertolak: '10:00', balik: '16:00' },
  { bertolak: '07:30', balik: '13:00' },
  { bertolak: '', balik: '' },
];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function uid() { return crypto.randomBytes(8).toString('hex'); }

function malaysiaDateStr(d) {
  const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 10);
}

function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function isPublicHoliday(ds) {
  return ['2025-06-02', '2025-07-07', '2025-08-01', '2025-08-31'].includes(ds);
}

function pickTujuan(sektor) {
  const relevant = TUJUANS.filter(t => !t.sektors || t.sektors.includes(sektor));
  return rnd(relevant).t;
}

function pickDest(tujuan) {
  if (tujuan === 'Berada di Pejabat') return 'Pejabat PPD Dalat';
  if (tujuan === 'Kebenaran Keluar Pejabat') return rnd(['Mukah', 'Sibu', 'Kuching', 'Klinik', 'Bank', 'Pejabat Pos']);
  if (tujuan === 'Cuti Rehat / Cuti Sakit') return 'Pejabat PPD Dalat';
  return rnd(DESTINATIONS);
}

function makeRecord(staff, dateStr, nota) {
  const tujuan = pickTujuan(staff.sektor);
  const dest = pickDest(tujuan);
  const masa = rnd(MASA_PAIRS);
  const createdAt = new Date(dateStr + 'T07:00:00+08:00').toISOString();
  return {
    id: uid(),
    nama: staff.nama,
    tarikh: dateStr,
    destinasi: dest,
    tujuan,
    nota: nota || '',
    masa: masa.bertolak,
    masa_balik: masa.balik,
    submittedby: staff.email,
    sektor: staff.sektor,
    created_at: createdAt,
  };
}

function generateMovements() {
  const records = [];
  const start = new Date('2025-06-01T00:00:00Z');
  const end   = new Date('2025-08-19T00:00:00Z');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = malaysiaDateStr(d);
    if (isWeekend(d) || isPublicHoliday(ds)) continue;

    const month = d.getMonth() + 1;
    let rate, activeSektors;
    if (month === 6) {
      activeSektors = ['SPr', 'SPb', 'SPbM'];
      rate = 0.6;
    } else if (month === 7) {
      activeSektors = ['SPr', 'SPb', 'SPbM', 'SPS', 'SP'];
      rate = 0.65;
    } else {
      activeSektors = null;
      rate = 0.88;
    }

    const pool_ = activeSektors ? STAFF.filter(s => activeSektors.includes(s.sektor)) : STAFF;
    const shuffled = [...pool_].sort(() => Math.random() - 0.5);
    const count = Math.ceil(shuffled.length * rate);
    const today = shuffled.slice(0, count);

    for (const staff of today) {
      records.push(makeRecord(staff, ds));
      if (Math.random() < 0.15 && month >= 7) {
        records.push(makeRecord(staff, ds, 'Perjalanan ke-2'));
      }
    }
  }
  return records;
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Creating tables...');
    await client.query(`CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, nama TEXT NOT NULL, tarikh TEXT NOT NULL, destinasi TEXT NOT NULL, tujuan TEXT NOT NULL, nota TEXT DEFAULT '', masa TEXT DEFAULT '', masa_balik TEXT DEFAULT '', submittedby TEXT DEFAULT '', sektor TEXT DEFAULT 'SPr', push_sent_at TEXT, created_at TEXT)`);
    await client.query(`CREATE TABLE IF NOT EXISTS staff (email TEXT PRIMARY KEY, nama TEXT NOT NULL, jawatan TEXT NOT NULL, sektor TEXT DEFAULT 'SPr')`);
    await client.query(`CREATE TABLE IF NOT EXISTS jawatan_list (jawatan TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL, ts TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, tajuk TEXT NOT NULL, isi TEXT NOT NULL, ts TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, created_at TEXT NOT NULL)`);

    console.log('Clearing existing data...');
    await client.query('DELETE FROM movements');
    await client.query('DELETE FROM staff');
    await client.query('DELETE FROM notices');

    console.log(`Inserting ${STAFF.length} staff...`);
    for (const s of STAFF) {
      await client.query('INSERT INTO staff (email, nama, jawatan, sektor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [s.email, s.nama, s.jawatan, s.sektor]);
    }

    const jawatans = [...new Set(STAFF.map(s => s.jawatan))];
    for (const j of jawatans) {
      await client.query('INSERT INTO jawatan_list (jawatan) VALUES ($1) ON CONFLICT DO NOTHING', [j]);
    }

    console.log('Generating movements...');
    const movements = generateMovements();
    console.log(`Inserting ${movements.length} movement records...`);
    for (const m of movements) {
      await client.query(
        `INSERT INTO movements (id,nama,tarikh,destinasi,tujuan,nota,masa,masa_balik,submittedby,sektor,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [m.id, m.nama, m.tarikh, m.destinasi, m.tujuan, m.nota, m.masa, m.masa_balik, m.submittedby, m.sektor, m.created_at]
      );
    }

    await client.query(`INSERT INTO notices (id,tajuk,isi,ts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), 'Selamat Datang ke e-Gerak PPD Dalat!',
       'Sistem e-Gerak PPD Dalat kini telah dilancarkan secara rasmi. Sila daftarkan pergerakan harian anda melalui sistem ini.',
       '2025-06-02T08:00:00.000Z']);
    await client.query(`INSERT INTO notices (id,tajuk,isi,ts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), 'Peringatan: Rekod Pergerakan Wajib Dikemas Kini',
       'Semua pegawai diwajibkan merekod pergerakan harian dalam sistem e-Gerak. Pastikan rekod dikemas kini setiap hari bekerja.',
       '2025-07-07T08:00:00.000Z']);

    const { rows } = await client.query(`SELECT SUBSTRING(tarikh,1,7) AS bulan, COUNT(*) AS jumlah FROM movements GROUP BY bulan ORDER BY bulan`);
    console.log('\n✅ Seed berjaya!');
    rows.forEach(r => console.log(`  ${r.bulan}: ${r.jumlah} rekod`));
    console.log(`Jumlah staf: ${STAFF.length}, Jumlah rekod: ${movements.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error('SEED ERROR:', e.message); process.exit(1); });
