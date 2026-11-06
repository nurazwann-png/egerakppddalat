// e-Tempahan: tempahan bot, kenderaan dan bilik (layan diri, tiada kelulusan).
// Bergantung pada global dalam index.html: API_BASE, currentUserSession, adminToken,
// showToast, escapeHtml, mytTodayStr, xlsxDownload, switchTab, toggleMultiday, handleTujuanChange.
'use strict';

const TP_JENIS = {
  kenderaan: { label: 'Kenderaan', icon: 'fa-van-shuttle' },
  bot: { label: 'Bot', icon: 'fa-ship' },
  bilik: { label: 'Bilik', icon: 'fa-door-open' },
};
const TP_HARI = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const TP_KURANG_LABEL = { aset: 'aset', tarikh: 'tarikh', 'masa mula': 'masa mula', 'masa tamat': 'masa tamat', tujuan: 'tujuan' };

const tpAddDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tpMonday = ds => tpAddDays(ds, -((new Date(ds + 'T00:00:00Z').getUTCDay() + 6) % 7));
const tpDow = ds => new Date(ds + 'T00:00:00Z').getUTCDay();
const tpDate = ds => `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}`;
const tpNowDt = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
const tpEsc = s => escapeHtml(s == null ? '' : String(s));
function tpRange(mula, tamat) {
  const d1 = mula.slice(0, 10), d2 = tamat.slice(0, 10);
  return d1 === d2
    ? `${TP_HARI[tpDow(d1)]}, ${tpDate(d1)}, ${mula.slice(11)}–${tamat.slice(11)}`
    : `${tpDate(d1)} ${mula.slice(11)} – ${tpDate(d2)} ${tamat.slice(11)}`;
}

const tp = {
  jenis: 'kenderaan',
  week: null,
  aset: [],
  tempahan: [],
  mine: [],
  draft: null,
  semak: null,
  extra: {},
  editingId: null,
  admin: { jenis: 'kenderaan', week: null, aset: [] },
};

// ── API ────────────────────────────────────────────────────────────────────
async function tpApi(path, { method = 'GET', body, admin = false } = {}) {
  const email = currentUserSession ? currentUserSession.email : '';
  const sep = path.includes('?') ? '&' : '?';
  const url = admin ? `${API_BASE}${path}` : `${API_BASE}${path}${sep}email=${encodeURIComponent(email)}`;
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['X-Admin-Token'] = adminToken;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(admin ? body : { ...body, email }) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, ok: res.ok, data: data || {} };
}

// ── Kalendar mingguan (dikongsi staf & admin) ──────────────────────────────
function tpRenderTypes(containerId, current, onPick) {
  document.getElementById(containerId).innerHTML = Object.entries(TP_JENIS).map(([k, v]) =>
    `<button type="button" class="tp-type-btn ${k === current ? 'active' : ''}" onclick="${onPick}('${k}')">
       <i class="fa-solid ${v.icon}"></i> ${v.label}</button>`).join('');
}

function tpRenderGrid(tableId, { aset, bookings, week, jenis, clickable }) {
  const table = document.getElementById(tableId);
  const today = mytTodayStr();
  const days = [0, 1, 2, 3, 4, 5, 6].map(n => tpAddDays(week, n));
  const list = aset.filter(a => a.jenis === jenis && a.status !== 'tidak_aktif');
  const head = `<thead><tr><th style="width:170px;">Aset</th>${days.map(d =>
    `<th class="${d === today ? 'tp-today' : ''}">${TP_HARI[tpDow(d)].slice(0, 3)}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`).join('')}</tr></thead>`;
  if (!list.length) {
    table.innerHTML = `${head}<tbody><tr><td colspan="8" class="tp-empty" style="text-align:center;">Tiada ${TP_JENIS[jenis].label.toLowerCase()} untuk ditempah. Admin boleh menambah aset dalam panel admin.</td></tr></tbody>`;
    return;
  }
  const rows = list.map(a => {
    const meta = [a.butiran, a.kapasiti ? `${a.kapasiti} orang` : ''].filter(Boolean).join(' · ');
    const badge = a.status === 'penyelenggaraan' ? ' <span class="tp-badge tp-badge-warn">Penyelenggaraan</span>' : '';
    const cells = days.map(d => {
      const dayStart = d + 'T00:00', dayEnd = tpAddDays(d, 1) + 'T00:00';
      const chips = bookings
        .filter(b => b.aset_id === a.id && b.mula < dayEnd && b.tamat > dayStart)
        .map(b => {
          const s = b.mula > dayStart ? b.mula.slice(11) : '00:00';
          const e = b.tamat < dayEnd ? b.tamat.slice(11) : '24:00';
          const who = b.nama ? `${tpEsc(b.nama)}${b.sektor ? ` (${tpEsc(b.sektor)})` : ''}` : 'Ditempah';
          return `<span class="tp-chip ${b.milik_saya ? 'tp-chip-mine' : ''}" title="${tpEsc(b.tujuan || '')}">${s}–${e}<br>${who}</span>`;
        }).join('');
      const canBook = clickable && a.status === 'aktif' && d >= today;
      return `<td class="tp-cell ${d === today ? 'tp-today' : ''} ${canBook ? 'tp-cell-click' : ''}"
        ${canBook ? `onclick="tpOpenForm({ aset_id: '${a.id}', jenis: '${a.jenis}', tarikh: '${d}' })" title="Tempah ${tpEsc(a.nama)} pada ${tpDate(d)}"` : ''}>${chips}</td>`;
    }).join('');
    return `<tr><td class="tp-aset-cell"><div class="tp-aset-name">${tpEsc(a.nama)}${badge}</div>${meta ? `<div class="tp-aset-meta">${tpEsc(meta)}</div>` : ''}</td>${cells}</tr>`;
  }).join('');
  table.innerHTML = `${head}<tbody>${rows}</tbody>`;
}

function tpWeekLabel(week) {
  return `${tpDate(week)} – ${tpDate(tpAddDays(week, 6))}`;
}

// Status buka/tutup ditentukan oleh pelayan (TEMPAHAN_DIBUKA)
let tpDibuka = null;
async function tpCheckOpen() {
  if (tpDibuka === null) {
    const r = await tpApi('/tempahan/status');
    tpDibuka = !!(r.ok && r.data.dibuka);
  }
  return tpDibuka;
}

// ── Staf: muat & papar ─────────────────────────────────────────────────────
async function tpLoad() {
  if (!currentUserSession) return;
  const open = await tpCheckOpen();
  document.getElementById('tp-coming-soon').style.display = open ? 'none' : '';
  document.getElementById('tp-content').style.display = open ? '' : 'none';
  if (!open) return;
  if (!tp.week) tp.week = tpMonday(mytTodayStr());
  const [aset, mine] = await Promise.all([tpApi('/aset'), tpApi('/tempahan/saya')]);
  tp.aset = aset.ok ? aset.data : [];
  tp.mine = mine.ok ? mine.data : [];
  await tpLoadWeek();
  tpRenderMine();
}

async function tpLoadWeek() {
  const r = await tpApi(`/tempahan?from=${tp.week}&to=${tpAddDays(tp.week, 6)}`);
  tp.tempahan = r.ok ? r.data : [];
  tpRenderTypes('tp-types', tp.jenis, 'tpSetJenis');
  document.getElementById('tp-week-label').textContent = tpWeekLabel(tp.week);
  tpRenderGrid('tp-grid', { aset: tp.aset, bookings: tp.tempahan, week: tp.week, jenis: tp.jenis, clickable: true });
}

function tpSetJenis(j) { tp.jenis = j; tpLoadWeek(); }
function tpShiftWeek(n) { tp.week = n === 0 ? tpMonday(mytTodayStr()) : tpAddDays(tp.week, n); tpLoadWeek(); }

function tpRenderMine() {
  const box = document.getElementById('tp-mine');
  const now = tpNowDt();
  const upcoming = tp.mine.filter(t => t.status === 'aktif' && t.tamat > now).sort((a, b) => a.mula.localeCompare(b.mula));
  const past = tp.mine.filter(t => t.status === 'aktif' && t.tamat <= now).slice(0, 10);
  const cancelled = tp.mine.filter(t => t.status === 'dibatalkan').slice(0, 5);
  const item = (t, kind) => {
    const j = TP_JENIS[t.aset_jenis] || TP_JENIS.bilik;
    const started = t.mula <= now;
    const badge = kind === 'akan' ? (started ? '<span class="tp-badge tp-badge-ok">Sedang berlangsung</span>' : '<span class="tp-badge tp-badge-ok">Aktif</span>')
      : kind === 'lepas' ? '<span class="tp-badge tp-badge-done">Selesai</span>' : '<span class="tp-badge tp-badge-cancel">Dibatalkan</span>';
    const warn = kind === 'akan' && t.aset_status !== 'aktif'
      ? `<div class="tp-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${tpEsc(t.aset_nama)} ${t.aset_status === 'penyelenggaraan' ? 'dalam penyelenggaraan' : 'tidak lagi aktif'}. Sila batalkan dan tempah aset lain.</div>` : '';
    const actions = kind === 'akan' && !started ? `
      ${t.aset_jenis !== 'bilik' ? `<button type="button" class="tp-btn tp-btn-outline" onclick="tpPrefillBorangFromId('${t.id}')" title="Isi borang rekod pergerakan"><i class="fa-solid fa-file-invoice"></i> Rekod pergerakan</button>` : ''}
      <button type="button" class="tp-btn tp-btn-outline" onclick="tpEditBooking('${t.id}')"><i class="fa-solid fa-pen"></i> Ubah</button>
      <button type="button" class="tp-btn tp-btn-outline" onclick="tpCancelBooking('${t.id}')"><i class="fa-solid fa-xmark"></i> Batal</button>` : '';
    const sub = [tpRange(t.mula, t.tamat), t.tujuan, t.destinasi, t.penumpang != null ? `${t.penumpang} orang` : ''].filter(Boolean).map(tpEsc).join(' · ');
    return `<div class="tp-mine-item">
      <div class="tp-mine-main">
        <div class="tp-mine-title"><i class="fa-solid ${j.icon}"></i> ${tpEsc(t.aset_nama)} ${badge}</div>
        <div class="tp-mine-sub">${sub}</div>${warn}
      </div>
      <div class="tp-mine-actions">${actions}</div>
    </div>`;
  };
  let html = '';
  html += `<div class="tp-mine-group">Akan datang</div>` + (upcoming.length ? upcoming.map(t => item(t, 'akan')).join('') : '<div class="tp-empty">Tiada tempahan akan datang.</div>');
  if (past.length) html += `<div class="tp-mine-group">Selesai</div>` + past.map(t => item(t, 'lepas')).join('');
  if (cancelled.length) html += `<div class="tp-mine-group">Dibatalkan</div>` + cancelled.map(t => item(t, 'batal')).join('');
  box.innerHTML = html;
}

// ── Borang ─────────────────────────────────────────────────────────────────
function tpFillAsetOptions(selectedId) {
  const jenis = document.getElementById('tp-f-jenis').value;
  const sel = document.getElementById('tp-f-aset');
  const list = tp.aset.filter(a => a.jenis === jenis && a.status === 'aktif');
  sel.innerHTML = list.length
    ? list.map(a => `<option value="${a.id}">${tpEsc(a.nama)}${a.kapasiti ? ` (${a.kapasiti} orang)` : ''}</option>`).join('')
    : '<option value="">Tiada aset tersedia</option>';
  if (selectedId && list.some(a => a.id === selectedId)) sel.value = selectedId;
  const isBilik = jenis === 'bilik';
  document.getElementById('tp-f-destinasi-wrap').style.display = isBilik ? 'none' : '';
  document.getElementById('tp-f-penumpang-label').textContent = isBilik ? 'Bilangan peserta' : 'Bilangan penumpang';
}

function tpSyncEndDate() {
  const s = document.getElementById('tp-f-tarikh-mula').value;
  const e = document.getElementById('tp-f-tarikh-tamat');
  if (s && (!e.value || e.value < s)) e.value = s;
}

async function tpOpenForm(pre = {}, editingId = null) {
  if (!tp.aset.length) {
    const r = await tpApi('/aset');
    tp.aset = r.ok ? r.data : [];
  }
  tp.editingId = editingId;
  document.getElementById('tp-form-title').innerHTML = editingId
    ? '<i class="fa-solid fa-pen"></i> Ubah Tempahan' : '<i class="fa-solid fa-calendar-plus"></i> Tempahan Baharu';
  const aset = tp.aset.find(a => a.id === pre.aset_id);
  document.getElementById('tp-f-jenis').value = (aset && aset.jenis) || pre.jenis || tp.jenis;
  tpFillAsetOptions(pre.aset_id);
  const tarikh = pre.tarikh || (pre.mula ? pre.mula.slice(0, 10) : '') || pre.tarikh_mula || mytTodayStr();
  document.getElementById('tp-f-tarikh-mula').value = tarikh;
  document.getElementById('tp-f-masa-mula').value = pre.mula ? pre.mula.slice(11) : (pre.masa_mula || '');
  document.getElementById('tp-f-tarikh-tamat').value = pre.tamat ? pre.tamat.slice(0, 10) : (pre.tarikh_tamat || tarikh);
  document.getElementById('tp-f-masa-tamat').value = pre.tamat ? pre.tamat.slice(11) : (pre.masa_tamat || '');
  document.getElementById('tp-f-tujuan').value = pre.tujuan || '';
  document.getElementById('tp-f-destinasi').value = pre.destinasi || '';
  document.getElementById('tp-f-penumpang').value = pre.penumpang ?? '';
  document.getElementById('tp-f-catatan').value = pre.catatan || '';
  document.getElementById('tp-form-overlay').style.display = 'flex';
  document.getElementById(pre.aset_id ? 'tp-f-masa-mula' : 'tp-f-jenis').focus();
}
function tpCloseForm() { document.getElementById('tp-form-overlay').style.display = 'none'; }

function tpFormSubmit(e) {
  e.preventDefault();
  const v = id => document.getElementById(id).value.trim();
  const draft = {
    aset_id: v('tp-f-aset'),
    mula: `${v('tp-f-tarikh-mula')}T${v('tp-f-masa-mula')}`,
    tamat: `${v('tp-f-tarikh-tamat')}T${v('tp-f-masa-tamat')}`,
    tujuan: v('tp-f-tujuan'),
    destinasi: v('tp-f-jenis') === 'bilik' ? '' : v('tp-f-destinasi'),
    penumpang: v('tp-f-penumpang') === '' ? null : Number(v('tp-f-penumpang')),
    catatan: v('tp-f-catatan'),
  };
  if (draft.tamat <= draft.mula) { showToast('Masa tamat mesti selepas masa mula.', 'error'); return; }
  tpCloseForm();
  tpShowCard(draft);
}

// ── Kad tempahan ───────────────────────────────────────────────────────────
async function tpShowCard(draft, { semak, kurang = [], dipilihAuto = false } = {}) {
  tp.draft = draft;
  tp.extra = { kurang, dipilihAuto };
  if (!semak && !kurang.length && draft.aset_id) {
    const r = await tpApi('/tempahan/semak', { method: 'POST', body: { ...draft, id: tp.editingId || undefined } });
    semak = r.data;
  }
  tp.semak = semak || null;
  tpRenderCard();
  document.getElementById('tp-card-overlay').style.display = 'flex';
}

function tpRenderCard() {
  const d = tp.draft, s = tp.semak, { kurang, dipilihAuto } = tp.extra;
  const aset = tp.aset.find(a => a.id === d.aset_id);
  const row = (k, v) => v ? `<tr><td>${k}</td><td>${v}</td></tr>` : '';
  const masa = d.mula && d.tamat && d.mula.length === 16 && d.tamat.length === 16 ? tpRange(d.mula, d.tamat) : '';
  let html = `<table class="tp-summary">
    ${row('Aset', aset ? `<i class="fa-solid ${TP_JENIS[aset.jenis].icon}"></i> ${tpEsc(aset.nama)}` : '<em>Belum dipilih</em>')}
    ${row('Masa', tpEsc(masa) || '<em>Belum lengkap</em>')}
    ${row('Tujuan', tpEsc(d.tujuan) || '<em>Belum diisi</em>')}
    ${row('Destinasi', tpEsc(d.destinasi))}
    ${row(aset && aset.jenis === 'bilik' ? 'Peserta' : 'Penumpang', d.penumpang != null ? `${d.penumpang} orang` : '')}
    ${row('Catatan', tpEsc(d.catatan))}
  </table>`;
  if (dipilihAuto && aset) html += `<div class="tp-status tp-status-warn" style="margin-top:10px;"><i class="fa-solid fa-robot"></i> Ejen memilih <strong>${tpEsc(aset.nama)}</strong> kerana ia kosong pada masa itu. Tekan Ubah untuk pilih aset lain.</div>`;

  let canConfirm = false;
  if (kurang.length) {
    html += `<div class="tp-status tp-status-warn"><i class="fa-solid fa-circle-info"></i> Maklumat belum lengkap: <strong>${kurang.map(k => TP_KURANG_LABEL[k] || k).join(', ')}</strong>. Tekan <strong>Ubah</strong> untuk melengkapkan.</div>`;
  } else if (!s) {
    html += `<div class="tp-status tp-status-warn">Sila pilih aset.</div>`;
  } else if (s.sah === false) {
    html += `<div class="tp-status tp-status-bad"><i class="fa-solid fa-circle-xmark"></i> ${tpEsc(s.error)}</div>`;
  } else if (s.tersedia) {
    html += `<div class="tp-status tp-status-ok"><i class="fa-solid fa-circle-check"></i> Tersedia. Tekan <strong>Sahkan</strong> untuk menempah.</div>`;
    canConfirm = true;
  } else {
    const who = (s.bertindih || []).map(b => `${tpEsc(b.nama)} (${tpEsc(b.sektor || '-')}), ${tpEsc(tpRange(b.mula, b.tamat))}`).join('<br>');
    const alts = [];
    for (const a of (s.cadangan?.aset_lain || [])) {
      alts.push(`<button type="button" class="tp-btn tp-btn-outline" onclick="tpUseAlt({ aset_id: '${a.id}' })"><i class="fa-solid fa-arrow-right-arrow-left"></i> Guna ${tpEsc(a.nama)}</button>`);
    }
    const slot = s.cadangan?.slot_seterusnya;
    if (slot) alts.push(`<button type="button" class="tp-btn tp-btn-outline" onclick="tpUseAlt({ mula: '${slot.mula}', tamat: '${slot.tamat}' })"><i class="fa-regular fa-clock"></i> ${tpEsc(tpRange(slot.mula, slot.tamat))}</button>`);
    html += `<div class="tp-status tp-status-bad"><i class="fa-solid fa-circle-xmark"></i> Sudah ditempah oleh:<br>${who}
      ${alts.length ? `<div style="margin-top:8px;font-weight:600;">Pilihan lain:</div><div class="tp-alt-list">${alts.join('')}</div>` : ''}</div>`;
  }
  document.getElementById('tp-card-body').innerHTML = html;
  document.getElementById('tp-card-title').innerHTML = tp.editingId
    ? '<i class="fa-solid fa-pen"></i> Sahkan Perubahan' : '<i class="fa-solid fa-ticket"></i> Sahkan Tempahan';
  const btn = document.getElementById('tp-card-confirm');
  btn.disabled = !canConfirm;
  btn.style.opacity = canConfirm ? '' : '0.5';
}

function tpUseAlt(change) {
  tpShowCard({ ...tp.draft, ...change });
}
function tpCloseCard() { document.getElementById('tp-card-overlay').style.display = 'none'; }
function tpCardEdit() {
  tpCloseCard();
  const d = tp.draft;
  const aset = tp.aset.find(a => a.id === d.aset_id);
  tpOpenForm({ ...d, jenis: aset ? aset.jenis : d.jenis }, tp.editingId);
}

async function tpConfirm() {
  const btn = document.getElementById('tp-card-confirm');
  btn.disabled = true;
  const editing = tp.editingId;
  const r = editing
    ? await tpApi(`/tempahan/${encodeURIComponent(editing)}`, { method: 'PATCH', body: tp.draft })
    : await tpApi('/tempahan', { method: 'POST', body: tp.draft });
  if (r.status === 409 && r.data.conflict) {
    tp.semak = { sah: true, ...r.data };
    tpRenderCard();
    showToast(r.data.error, 'error');
    return;
  }
  if (!r.ok) {
    btn.disabled = false;
    showToast(r.data.error || 'Gagal menyimpan tempahan.', 'error');
    return;
  }
  tpCloseCard();
  showToast(editing ? 'Tempahan dikemaskini.' : `Tempahan ${r.data.aset?.nama || ''} disahkan.`, 'success');
  const saved = { ...tp.draft };
  tp.editingId = null;
  await tpLoad();
  if (!editing && r.data.aset && r.data.aset.jenis !== 'bilik') {
    if (await tpAskToast('Tambah perjalanan ini ke rekod pergerakan anda?', 'Ya, isi borang', 'Tidak')) {
      tpPrefillBorang(saved, r.data.aset.nama);
    }
  }
}

async function tpEditBooking(id) {
  const t = tp.mine.find(x => x.id === id);
  if (!t) return;
  tpOpenForm({ aset_id: t.aset_id, jenis: t.aset_jenis, mula: t.mula, tamat: t.tamat, tujuan: t.tujuan,
    destinasi: t.destinasi, penumpang: t.penumpang, catatan: t.catatan }, id);
}

async function tpCancelBooking(id) {
  const t = tp.mine.find(x => x.id === id);
  if (!t) return;
  if (!(await tpAskToast(`Batalkan tempahan ${t.aset_nama} (${tpRange(t.mula, t.tamat)})?`, 'Ya, batalkan', 'Tidak'))) return;
  const r = await tpApi(`/tempahan/${encodeURIComponent(id)}/batal`, { method: 'POST', body: {} });
  if (!r.ok) { showToast(r.data.error || 'Gagal membatalkan.', 'error'); return; }
  showToast('Tempahan dibatalkan.', 'success');
  tpLoad();
}

// Toast pengesahan ringkas (Ya / Tidak)
function tpAskToast(message, yesLabel, noLabel) {
  return new Promise(resolve => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-confirm';
    toast.setAttribute('role', 'alertdialog');
    const head = document.createElement('div');
    head.className = 'toast-confirm-head';
    head.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
    const text = document.createElement('div');
    text.textContent = message;
    head.appendChild(text);
    const actions = document.createElement('div');
    actions.className = 'toast-confirm-actions';
    const no = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-btn-no', textContent: noLabel });
    const yes = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-btn-yes', textContent: yesLabel });
    actions.append(no, yes);
    toast.append(head, actions);
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 50);
    yes.focus();
    const close = v => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); resolve(v); };
    yes.addEventListener('click', () => close(true));
    no.addEventListener('click', () => close(false));
  });
}

// Isi borang rekod pergerakan sedia ada (pengguna semak & hantar sendiri)
function tpPrefillBorang(b, asetNama) {
  switchTab('borang');
  const d1 = b.mula.slice(0, 10), d2 = b.tamat.slice(0, 10);
  document.getElementById('tarikh_pergerakan').value = d1;
  const multi = d2 > d1;
  document.getElementById('multiday-toggle').checked = multi;
  toggleMultiday(multi);
  if (multi) document.getElementById('tarikh_akhir').value = d2;
  document.getElementById('destinasi').value = b.destinasi || asetNama || '';
  document.getElementById('tujuan').value = b.tujuan || '';
  handleTujuanChange(b.tujuan || '');
  document.getElementById('masa_bertolak').value = b.mula.slice(11);
  document.getElementById('masa_balik').value = multi ? '' : b.tamat.slice(11);
  showToast('Borang telah diisi. Semak dan tekan Hantar Rekod.', 'success');
}
function tpPrefillBorangFromId(id) {
  const t = tp.mine.find(x => x.id === id);
  if (t) tpPrefillBorang(t, t.aset_nama);
}

// ── Ejen ───────────────────────────────────────────────────────────────────
async function tpParse(message) {
  return tpApi('/tempahan/parse', { method: 'POST', body: { message } });
}

async function tpEjenParse() {
  const input = document.getElementById('tp-ejen-input');
  const btn = document.getElementById('tp-ejen-btn');
  const message = input.value.trim();
  if (!message) { input.focus(); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    if (!tp.aset.length) { const a = await tpApi('/aset'); tp.aset = a.ok ? a.data : []; }
    const r = await tpParse(message);
    if (!r.ok) { showToast(r.data.error || 'Ejen tidak dapat memproses. Sila guna borang.', 'error'); return; }
    tp.editingId = null;
    await tpShowCard(r.data.draft, { semak: r.data.semak, kurang: r.data.kurang || [], dipilihAuto: r.data.dipilih_auto });
    input.value = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sediakan';
  }
}

// Dipanggil oleh widget Ejen apabila mesej berbunyi seperti permintaan tempahan
function tpIsBookingRequest(message) {
  return !!currentUserSession && /\b(tempah|booking|book)\b/i.test(message);
}
async function tpHandleEjenBooking(message) {
  if (!(await tpCheckOpen())) return 'e-Tempahan akan dibuka pada tahun 2027 (coming soon). Buat masa ini, sila buat tempahan melalui kaedah sedia ada.';
  if (!tp.aset.length) { const a = await tpApi('/aset'); tp.aset = a.ok ? a.data : []; }
  const r = await tpParse(message);
  if (!r.ok) return r.data.error || 'Maaf, saya tidak dapat memproses tempahan itu. Sila guna borang dalam tab e-Tempahan.';
  const { draft, semak, kurang = [], dipilih_auto } = r.data;
  tp.editingId = null;
  await tpShowCard(draft, { semak, kurang, dipilihAuto: dipilih_auto });
  if (kurang.length) return `Saya sudah sediakan draf tempahan, tetapi ${kurang.join(', ')} belum dinyatakan. Sila lengkapkan dalam kad tempahan.`;
  if (semak && semak.sah && semak.tersedia) return 'Draf tempahan sudah sedia dan slot masih kosong. Sila semak kad tempahan dan tekan Sahkan.';
  if (semak && semak.sah === false) return `Tempahan belum boleh dibuat: ${semak.error}`;
  return 'Slot itu sudah ditempah. Saya tunjukkan pilihan lain dalam kad tempahan.';
}

// ── Admin ──────────────────────────────────────────────────────────────────
async function tpAdminLoad() {
  if (!tp.admin.week) tp.admin.week = tpMonday(mytTodayStr());
  const monthInput = document.getElementById('tp-an-month');
  if (!monthInput.value) monthInput.value = mytTodayStr().slice(0, 7);
  await tpAdminLoadAset();
  await Promise.all([tpAdminLoadWeek(), tpAdminRenderAnalysis()]);
}

async function tpAdminLoadAset() {
  const r = await tpApi('/admin/aset', { admin: true });
  tp.admin.aset = r.ok ? r.data : [];
  const statusLabel = { aktif: 'Aktif', penyelenggaraan: 'Penyelenggaraan', tidak_aktif: 'Tidak aktif' };
  document.getElementById('tp-aset-body').innerHTML = tp.admin.aset.map(a => `
    <tr>
      <td><i class="fa-solid ${TP_JENIS[a.jenis].icon}"></i> ${TP_JENIS[a.jenis].label}</td>
      <td style="font-weight:600;">${tpEsc(a.nama)}</td>
      <td>${tpEsc(a.butiran || '-')}</td>
      <td>${a.kapasiti || '-'}</td>
      <td>${a.tempahan_akan_datang}</td>
      <td>
        <label class="tp-sr" for="tp-status-${a.id}">Status ${tpEsc(a.nama)}</label>
        <select id="tp-status-${a.id}" class="form-select" style="padding:5px 8px;font-size:0.8rem;" onchange="tpAdminSetStatus('${a.id}', this)">
          ${Object.entries(statusLabel).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </td>
      <td><button type="button" class="staff-action-btn staff-action-edit" onclick="tpAdminEditAset('${a.id}')"><i class="fa-solid fa-pen"></i> Edit</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="tp-empty" style="text-align:center;">Belum ada aset. Tambah bot, kenderaan atau bilik di atas.</td></tr>';
}

async function tpAdminLoadWeek() {
  const w = tp.admin.week;
  const r = await tpApi(`/admin/tempahan?from=${w}&to=${tpAddDays(w, 6)}`, { admin: true });
  const bookings = (r.ok ? r.data : []).filter(b => b.status === 'aktif');
  tpRenderTypes('tp-admin-types', tp.admin.jenis, 'tpAdminSetJenis');
  document.getElementById('tp-admin-week-label').textContent = tpWeekLabel(w);
  tpRenderGrid('tp-admin-grid', { aset: tp.admin.aset, bookings, week: w, jenis: tp.admin.jenis, clickable: false });
}
function tpAdminSetJenis(j) { tp.admin.jenis = j; tpAdminLoadWeek(); }
function tpAdminShiftWeek(n) { tp.admin.week = n === 0 ? tpMonday(mytTodayStr()) : tpAddDays(tp.admin.week, n); tpAdminLoadWeek(); }

async function tpAdminSaveAset(e) {
  e.preventDefault();
  const body = {
    id: document.getElementById('tp-a-id').value || undefined,
    jenis: document.getElementById('tp-a-jenis').value,
    nama: document.getElementById('tp-a-nama').value.trim(),
    butiran: document.getElementById('tp-a-butiran').value.trim(),
    kapasiti: document.getElementById('tp-a-kapasiti').value,
  };
  const r = await tpApi('/admin/aset', { method: 'POST', body, admin: true });
  if (!r.ok) { showToast(r.data.error || 'Gagal menyimpan aset.', 'error'); return; }
  showToast(body.id ? 'Aset dikemaskini.' : 'Aset ditambah.', 'success');
  tpAdminResetAsetForm();
  await tpAdminLoadAset();
  tpAdminLoadWeek();
}
function tpAdminEditAset(id) {
  const a = tp.admin.aset.find(x => x.id === id);
  if (!a) return;
  document.getElementById('tp-a-id').value = a.id;
  document.getElementById('tp-a-jenis').value = a.jenis;
  document.getElementById('tp-a-nama').value = a.nama;
  document.getElementById('tp-a-butiran').value = a.butiran || '';
  document.getElementById('tp-a-kapasiti').value = a.kapasiti || '';
  document.getElementById('tp-a-submit').textContent = 'Simpan';
  document.getElementById('tp-a-cancel').style.display = '';
  document.getElementById('tp-aset-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function tpAdminResetAsetForm() {
  document.getElementById('tp-aset-form').reset();
  document.getElementById('tp-a-id').value = '';
  document.getElementById('tp-a-submit').textContent = 'Tambah';
  document.getElementById('tp-a-cancel').style.display = 'none';
}
async function tpAdminSetStatus(id, sel) {
  const a = tp.admin.aset.find(x => x.id === id);
  const status = sel.value;
  if (status !== 'aktif' && a.tempahan_akan_datang > 0) {
    const ok = await tpAskToast(`${a.nama} ada ${a.tempahan_akan_datang} tempahan akan datang. Pemilik akan dimaklumkan untuk menempah semula. Teruskan?`, 'Ya, teruskan', 'Batal');
    if (!ok) { sel.value = a.status; return; }
  }
  const r = await tpApi(`/admin/aset/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status }, admin: true });
  if (!r.ok) { showToast(r.data.error || 'Gagal menukar status.', 'error'); sel.value = a.status; return; }
  showToast(r.data.terjejas ? `Status dikemaskini. ${r.data.terjejas} pemilik tempahan dimaklumkan.` : 'Status dikemaskini.', 'success');
  await tpAdminLoadAset();
  tpAdminLoadWeek();
}

// ── Admin: analisis ────────────────────────────────────────────────────────
function tpMonthRange(ym) {
  const from = ym + '-01';
  const next = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 1)).toISOString().slice(0, 10);
  return { from, to: tpAddDays(next, -1) };
}
const tpMs = dt => Date.parse(dt + ':00Z');

function tpBars(containerId, entries, max = 6) {
  const el = document.getElementById(containerId);
  const top = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
  if (!top.length) { el.innerHTML = '<div class="tp-empty">Tiada data.</div>'; return; }
  const peak = top[0][1];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors = ['#1d4ed8', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777'];
  el.innerHTML = top.map(([k, v], i) => `<div class="tj-card" style="--fill:${Math.round(v / peak * 100)}%;--clr:${colors[i % colors.length]};--clr-bg:${colors[i % colors.length]}1a;">
    <div class="tj-fill"></div><div class="tj-dot"></div>
    <div class="tj-name" title="${tpEsc(k)}">${tpEsc(k)}</div><div class="tj-num">${v}</div>
    <div class="tj-pct">${Math.round(v / total * 100)}%</div></div>`).join('');
}

let tpAnalysisRows = [];
let tpUtilRows = [];
async function tpAdminRenderAnalysis() {
  const ym = document.getElementById('tp-an-month').value || mytTodayStr().slice(0, 7);
  const { from, to } = tpMonthRange(ym);
  const r = await tpApi(`/admin/tempahan?from=${from}&to=${to}`, { admin: true });
  const all = r.ok ? r.data : [];
  tpAnalysisRows = all;
  const rows = all.filter(b => b.status === 'aktif');
  const cancelled = all.length - rows.length;

  // Waktu bekerja: Isnin–Jumaat 08:00–17:00
  const workDays = [];
  for (let d = from; d <= to; d = tpAddDays(d, 1)) if (tpDow(d) >= 1 && tpDow(d) <= 5) workDays.push(d);
  const capMin = workDays.length * 9 * 60;
  const usedMin = {};
  for (const b of rows) {
    for (const d of workDays) {
      const s = Math.max(tpMs(b.mula), tpMs(d + 'T08:00')), e = Math.min(tpMs(b.tamat), tpMs(d + 'T17:00'));
      if (e > s) usedMin[b.aset_id] = (usedMin[b.aset_id] || 0) + (e - s) / 60000;
    }
  }
  const aset = tp.admin.aset.filter(a => a.status !== 'tidak_aktif' || rows.some(b => b.aset_id === a.id));
  const util = aset.map(a => ({ a, n: rows.filter(b => b.aset_id === a.id).length, pct: capMin ? Math.round((usedMin[a.id] || 0) / capMin * 100) : 0 }))
    .sort((x, y) => y.pct - x.pct);
  tpUtilRows = util.map(({ a, n, pct }) => ({
    Aset: a.nama, Jenis: TP_JENIS[a.jenis].label, 'Bilangan tempahan': n,
    'Jam ditempah (waktu bekerja)': Math.round((usedMin[a.id] || 0) / 60 * 10) / 10, 'Kadar penggunaan (%)': pct,
  }));

  const leadDays = rows.map(b => (tpMs(b.mula) - (Date.parse(b.created_at) + 8 * 3600000)) / 86400000).filter(x => x >= 0);
  const avgLead = leadDays.length ? (leadDays.reduce((s, x) => s + x, 0) / leadDays.length) : null;
  const card = (lbl, val) => `<div class="tp-card"><div class="tp-card-lbl">${lbl}</div><div class="tp-card-val">${val}</div></div>`;
  document.getElementById('tp-an-cards').innerHTML =
    card('Jumlah tempahan', rows.length) +
    card('Dibatalkan', all.length ? `${cancelled} (${Math.round(cancelled / all.length * 100)}%)` : '0') +
    card('Purata ditempah awal', avgLead == null ? '-' : `${avgLead.toFixed(1)} hari`) +
    card('Aset paling digunakan', util[0] && util[0].pct > 0 ? `${tpEsc(util[0].a.nama)} (${util[0].pct}%)` : '-');

  document.getElementById('tp-an-aset').innerHTML = util.length ? util.map(({ a, n, pct }) => `
    <div class="tp-util-row">
      <div><i class="fa-solid ${TP_JENIS[a.jenis].icon}"></i> ${tpEsc(a.nama)} <span style="color:var(--text-muted);">· ${n} tempahan</span>
        <div class="tp-util-bar"><span style="width:${Math.min(pct, 100)}%;"></span></div></div>
      <div style="text-align:right;font-weight:700;">${pct}%</div>
    </div>`).join('') : '<div class="tp-empty">Tiada aset.</div>';

  const count = (fn) => { const m = {}; rows.forEach(b => { const k = fn(b); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m); };
  tpBars('tp-an-sektor', count(b => b.sektor || '-'), 8);
  const hari = count(b => TP_HARI[tpDow(b.mula.slice(0, 10))]);
  tpBars('tp-an-hari', hari, 7);
  tpBars('tp-an-jam', count(b => `${b.mula.slice(11, 13)}:00`), 6);
  tpBars('tp-an-tujuan', count(b => (b.tujuan || '').trim()), 6);
  tpBars('tp-an-destinasi', count(b => b.aset_jenis !== 'bilik' ? (b.destinasi || '').trim() : ''), 6);
}

async function tpAdminExport() {
  const ym = document.getElementById('tp-an-month').value || mytTodayStr().slice(0, 7);
  if (!tpAnalysisRows.length) { showToast('Tiada tempahan untuk bulan ini.', 'error'); return; }
  const wb = XLSX.utils.book_new();
  const rows = tpAnalysisRows.map(b => ({
    Aset: b.aset_nama, Jenis: TP_JENIS[b.aset_jenis]?.label || b.aset_jenis,
    'Tarikh mula': tpDate(b.mula.slice(0, 10)), 'Masa mula': b.mula.slice(11),
    'Tarikh tamat': tpDate(b.tamat.slice(0, 10)), 'Masa tamat': b.tamat.slice(11),
    Nama: b.nama, Sektor: b.sektor || '', Tujuan: b.tujuan, Destinasi: b.destinasi || '',
    'Penumpang/Peserta': b.penumpang ?? '', Status: b.status === 'dibatalkan' ? 'Dibatalkan' : (b.tamat <= tpNowDt() ? 'Selesai' : 'Aktif'),
    'Ditempah pada': b.created_at ? new Date(Date.parse(b.created_at) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tempahan');
  if (tpUtilRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tpUtilRows), 'Penggunaan Aset');
  await xlsxDownload(wb, `e-Tempahan_${ym}.xlsx`);
}
