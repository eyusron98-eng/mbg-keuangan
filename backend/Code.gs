/**
 * ============================================================
 *  KEUANGAN MBG — Backend v6 (Google Apps Script)
 *  Untuk: Koperasi ISS
 * ============================================================
 *
 *  v6: Pengajuan anggaran harian → persetujuan Yayasan → realisasi
 *  - Sheet baru: Sesi, Penerima, Pengajuan, PengajuanItem
 *  - Dapur: kolom kode (CPJ02, MKS01, SKM01, CPK02) untuk nomor BA
 *  - Transaksi: kolom pengajuan_item_id (kosong = data lama, DARURAT = input admin)
 *  - Akuntan tidak bisa input transaksi bebas; wajib Pengajuan → Realisasi
 *  - Yang bisa approve: yayasan, pic (dapurnya sendiri), admin — lihat ROLE_PENYETUJU; validasi VA tersedia
 *  - Role & dapur untuk aksi baru diverifikasi dari token sesi di server
 *  - Role 'asisten': input pengajuan Bahan Baku untuk semua dapur (tanpa realisasi)
 *  - 1 nomor Berita Acara per dapur per hari (pengajuan akuntan + asisten digabung)
 *  - Edit/hapus transaksi periode lalu: diajukan akuntan, disetujui admin (sheet PerubahanTx)
 *  - SEMUA aksi wajib token sesi; role/dapur diambil dari server
 *
 *  Cara update dari v5:
 *  1. Paste seluruh kode ini ke editor Apps Script (timpa yang lama), Save
 *  2. Pilih fungsi 'migrateV6' → Run (sekali saja; aman diulang)
 *  3. Deploy → Manage deployments → ✏️ → Version: New version → Deploy
 *  4. Update index.html di GitHub
 *  5. SEMUA pengguna wajib Keluar lalu Masuk lagi (sesi lama tidak berlaku)
 * ============================================================
 */

/**
 *  PATCH KEAMANAN (sec1) — di atas v6:
 *  - Password disimpan sebagai hash bergaram (h1$garam$hash), tidak lagi teks biasa.
 *    Password lama (teks biasa) tetap bisa login dan otomatis di-hash saat login berhasil.
 *  - getUsers tidak lagi mengirim password ke browser.
 *  - Login dibatasi: 5x salah untuk satu username → ditahan 10 menit.
 *  - Ganti/reset password → sesi lama pengguna itu dicabut.
 *  - createPengajuan: request_id yang sama tidak membuat pengajuan ganda (kirim ulang aman).
 *  - Aksi berpassword lewat GET (alamat web) bisa dimatikan: LOGIN_VIA_GET_DIBOLEH = false.
 *  sec2: Berita Acara — asisten boleh melihat/mencetak; getBADaftar bisa dibatasi (hari ini / periode aktif / satu periode).
 *  sec3: getPenandatangan — nama akuntan dapur untuk kolom tanda tangan Laporan Keuangan.
 *  sec4: LOGIN_VIA_GET_DIBOLEH = false — login & aksi berpassword lewat GET (alamat web) ditolak.
 *
 *  Urutan pasang: (1) salin Sheet sebagai cadangan, (2) tempel kode ini + Save,
 *  (3) Deploy → New version, (4) jalankan migrasiHashPassword sekali, (5) tes login,
 *  (6) setelah semua pengguna memakai index.html baru, ubah LOGIN_VIA_GET_DIBOLEH ke false + Deploy ulang.
 */
const LOGIN_VIA_GET_DIBOLEH = false;  // sec4: ditutup — login/ganti password hanya lewat POST (index.html sejak 26 Okt 2026)
const AKSI_BERPASSWORD = ['login', 'updateMyProfile', 'addUser', 'updateUser'];
const PW_MIN = 6;
// Peran yang boleh memutuskan pengajuan. PIC dibatasi ke dapurnya sendiri; yayasan & admin ke semua dapur.
const ROLE_PENYETUJU = ['yayasan', 'pic', 'admin'];

const SPREADSHEET_ID = 'ISI_ID_SPREADSHEET';   // ← isi ID Google Sheet saat memulihkan (lihat backend/README.md)
const DRIVE_FOLDER_ID = 'ISI_ID_FOLDER_DRIVE'; // ← isi ID folder Drive bukti saat memulihkan

const SHEETS = {
  USERS: 'Users', DAPUR: 'Dapur', SETUP: 'Setup',
  PETTY: 'PettyTopup', VA: 'VATopup',
  TRANSAKSI: 'Transaksi', LOG: 'Log',
  SESI: 'Sesi', PENERIMA: 'Penerima',
  PENGAJUAN: 'Pengajuan', PITEM: 'PengajuanItem',
  PERUBAHAN: 'PerubahanTx', LPDH: 'IdentitasLPDH', LPDH_HARIAN: 'LPDHHarian', RELAWAN: 'RelawanBayar', INSENTIF: 'InsentifBayar', LPDH_SALDO: 'LPDHSaldo', RENCANA: 'RencanaOps',
};

const JENIS_KATEGORI = {
  'Bahan Baku': ['Semua Kategori'],
  'Operasional': [
    'Gaji/honor relawan pekerja SPPG',
    'Insentif Guru/PIC Sekolah',
    'Insentif Kader Posyandu',
    'Asuransi kecelakaan kerja (BPJS) relawan',
    'Sewa Kendaraan',
    'Listrik',
    'Air Galon Masak',
    'Air Bersih (Sumur)',
    'BBM Operasional Kendaraan',
    'Pulsa',
    'Internet/Telepon',
    'Gas',
    'ATK',
    'Alat Kebersihan',
    'Air Minum',
    'APD',
    'Barang Habis Pakai',
    'Sampah',
    'Jasa General Cleaning',
    'Kecelakaan/Musibah/Duka',
    'Konsumsi Tamu',
    'Biaya Rapat Koordinasi',
    'Perlengkapan Dapur',
    'Survey Lapangan',
    'Survey Pasar',
    'Biaya Admin Bank',
    'Lain-lain',
  ],
  'Fasilitas SPPG': ['Sewa Gedung'],
};
// Kategori lama yang tidak bisa dipilih lagi, tetapi data lamanya tetap sah selama kategorinya tidak diubah
const KATEGORI_LAMA = {};
// "Barang Habis Pakai" BOLEH (tidak wajib) dipindah ke baris LPDH saat realisasi / edit realisasi
const SUB_BHP = ['ATK', 'Alat Kebersihan', 'APD', 'Lain-lain'];
// Kategori Operasional yang nilai realisasinya sama dengan anggaran pengajuan.
// Bahan Baku & Fasilitas SPPG (Sewa Gedung) juga sama; Operasional lainnya (termasuk BPJS & Biaya Admin Bank manual) punya nilai rencana realisasi (aktual).
const KATEGORI_OPS_REALISASI_SAMA = [
  'Gaji/honor relawan pekerja SPPG',
  'Insentif Guru/PIC Sekolah',
  'Insentif Kader Posyandu',
];
function butuhRencanaRealisasi(jenis, kategori) {
  return jenis === 'Operasional' && KATEGORI_OPS_REALISASI_SAMA.indexOf(kategori) < 0;
}
function kategoriSah(jenis, kat, katLama) {
  const daftar = JENIS_KATEGORI[jenis];
  return !!daftar && (daftar.indexOf(kat) >= 0 || (kat === katLama && (KATEGORI_LAMA[jenis] || []).indexOf(kat) >= 0));
}

// ============================================================
//  ENTRY POINTS
// ============================================================

function doGet(e) { return handleRequest(e, 'GET'); }
function doPost(e) { return handleRequest(e, 'POST'); }

function handleRequest(e, method) {
  resetReqCache();
  try {
    let params = {};
    if (method === 'GET') params = (e && e.parameter) || {};
    else {
      if (e && e.postData && e.postData.contents) {
        try { params = JSON.parse(e.postData.contents); }
        catch (err) { params = e.parameter || {}; }
      } else { params = (e && e.parameter) || {}; }
    }

    const action = params.action || '';
    if (method === 'GET' && !LOGIN_VIA_GET_DIBOLEH && AKSI_BERPASSWORD.indexOf(action) >= 0) {
      return jsonResponse({ ok: false, error: 'Muat ulang halaman (Ctrl+Shift+R) untuk memakai versi aplikasi terbaru.' });
    }
    // v6: semua aksi (kecuali ping & login) wajib token sesi. Role, user_id, dan dapur
    // diambil dari server — nilai yang dikirim browser diabaikan.
    if (action !== 'ping' && action !== 'login') {
      const me = authUser(params);
      if (!me) return jsonResponse({ ok: false, error: SESI_ERR });
      params.role = me.role;
      params.user_id = me.id;
      if (me.role === 'akuntan' || me.role === 'pic' || me.role === 'aslap') params.dapur = me.dapur;
    }
    let result;
    switch (action) {
      case 'ping':              result = { ok: true, time: new Date().toISOString(), version: 'v6-ba-sec32' }; break;
      case 'login':             result = login(params); break;
      case 'getPeriodeList':    result = getPeriodeList(params); break;
      case 'getActivePeriode':  result = getActivePeriode(params); break;
      case 'addPeriode':        result = addPeriode(params); break;
      case 'updatePeriode':     result = updatePeriode(params); break;
      case 'closePeriode':      result = closePeriode(params); break;
      case 'deletePeriode':     result = deletePeriode(params); break;
      case 'addPettyTopup':     result = addPettyTopup(params); break;
      case 'getPettyTopups':    result = getPettyTopups(params); break;
      case 'addVATopup':        result = addVATopup(params); break;
      case 'getVATopups':       result = getVATopups(params); break;
      case 'getTransaksi':      result = getTransaksi(params); break;
      case 'addTransaksi':      result = addTransaksi(params); break;
      case 'updateTransaksi':   result = updateTransaksi(params); break;
      case 'deleteTransaksi':   result = deleteTransaksi(params); break;
      case 'getDashboard':      result = getDashboard(params); break;
      case 'getMyProfile':      result = getMyProfile(params); break;
      case 'updateMyProfile':   result = updateMyProfile(params); break;
      case 'getUsers':          result = getUsers(params); break;
      case 'addUser':           result = addUser(params); break;
      case 'updateUser':        result = updateUser(params); break;
      case 'deleteUser':        result = deleteUser(params); break;
      case 'getDapur':          result = getDapur(); break;
      case 'addDapur':          result = addDapur(params); break;
      case 'updateDapur':       result = updateDapur(params); break;
      case 'updateIdentitasDapur': result = updateIdentitasDapur(params); break;
      case 'deleteDapur':       result = deleteDapur(params); break;
      case 'getKategori':       result = { ok: true, data: JENIS_KATEGORI }; break;
      case 'uploadBukti':       result = uploadBukti(params); break;
      // v6 — Pengajuan anggaran
      case 'getPenerima':       result = getPenerima(params); break;
      case 'savePenerima':      result = savePenerima(params); break;
      case 'createPengajuan':   result = createPengajuan(params); break;
      case 'getPengajuan':      result = getPengajuan(params); break;
      case 'updatePengajuanItem': result = updatePengajuanItem(params); break;
      case 'batalkanItem':      result = batalkanItem(params); break;
      case 'decidePengajuan':   result = decidePengajuan(params); break;
      case 'decideBackdatePengajuan': result = decideBackdatePengajuan(params); break;
      case 'getRealisasiList':  result = getRealisasiList(params); break;
      case 'realisasiItem':     result = realisasiItem(params); break;
      case 'addBiayaAdmin':     result = addBiayaAdmin(params); break;
      case 'requestTxChange':   result = requestTxChange(params); break;
      case 'getTxChanges':      result = getTxChanges(params); break;
      case 'decideTxChange':    result = decideTxChange(params); break;
      // v6 — Berita Acara & tanda tangan akuntan
      case 'getTtd':            result = getTtd(params); break;
      case 'saveTtd':           result = saveTtd(params); break;
      case 'getKwitansiHarian': result = getKwitansiHarian(params); break;
      case 'terbitkanKwitansi': result = terbitkanKwitansi(params); break;
      case 'simpanKwitansiFile': result = simpanKwitansiFile(params); break;
      case 'getKwitansiCetak':   result = getKwitansiCetak(params); break;
      case 'getTugasHarian':     result = getTugasHarian(params); break;
      case 'realisasiMassal':    result = realisasiMassal(params); break;
      case 'getBankVA':          result = getBankVA(params); break;
      case 'getKwitansiPerlu':   result = getKwitansiPerlu(params); break;
      case 'getTtdPengesahan':   result = getTtdPengesahan(params); break;
      case 'hapusTtd':          result = hapusTtd(params); break;
      case 'getDataPenerima':   result = getDataPenerima(params); break;
      case 'saveDataPenerima':  result = saveDataPenerima(params); break;
      case 'hapusDataPenerima': result = hapusDataPenerima(params); break;
      case 'getBeritaAcara':    result = getBeritaAcara(params); break;
      case 'getBADaftar':       result = getBADaftar(params); break;
      case 'getIdentitasLPDH':  result = getIdentitasLPDH(params); break;
      case 'saveIdentitasLPDH': result = saveIdentitasLPDH(params); break;
      case 'getDataLPDH':       result = getDataLPDH(params); break;
      case 'getRencanaOps':     result = getRencanaOps(params); break;
      case 'saveRencanaOps':    result = saveRencanaOps(params); break;
      case 'getPaguOps':        result = getPaguOps(params); break;
      case 'getHarianLPDH':     result = getHarianLPDH(params); break;
      case 'saveHarianLPDH':    result = saveHarianLPDH(params); break;
      case 'getRelawanBayar':   result = getRelawanBayar(params); break;
      case 'saveRelawanBayar':  result = saveRelawanBayar(params); break;
      case 'getRelawanTetap':   result = getRelawanTetap(params); break;
      case 'saveRelawanTetap':  result = saveRelawanTetap(params); break;
      case 'saveTopupLPDH':     result = saveTopupLPDH(params); break;
      case 'saveInsentifLPDH':  result = saveInsentifLPDH(params); break;
      case 'saveTtdInsentif':   result = saveTtdInsentif(params); break;
      case 'saveSaldoLPDH':     result = saveSaldoLPDH(params); break;
      case 'getPenandatangan':  result = getPenandatangan(params); break;
      case 'getLogoKop':        result = getLogoKop(params); break;
      case 'saveLogoKop':       result = saveLogoKop(params); break;
      default: result = { ok: false, error: 'Unknown action: ' + action };
    }
    return jsonResponse(result);
  } catch (err) {
    logError(err);
    return jsonResponse({ ok: false, error: pesanGangguan(err && err.message) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  PASSWORD — hash bergaram (SHA-256 berulang). Format tersimpan: h1$<garam>$<hash>
// ============================================================
const PW_PREFIX = 'h1$';
const PW_ROUNDS = 300;   // turunkan (mis. 100) bila login terasa lambat; naikkan bila ingin lebih kuat

function pwDigest(salt, password) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltBytes.concat(Utilities.newBlob(String(password)).getBytes()));
  for (let i = 1; i < PW_ROUNDS; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(saltBytes));
  return Utilities.base64EncodeWebSafe(d);
}
function pwMake(password) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  return PW_PREFIX + salt + '$' + pwDigest(salt, password);
}
function pwIsHashed(stored) { return String(stored).indexOf(PW_PREFIX) === 0; }
function pwEqual(a, b) {   // perbandingan waktu-konstan
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function pwCheck(stored, password) {
  stored = String(stored);
  if (pwIsHashed(stored)) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    return pwEqual(pwDigest(parts[1], password), parts[2]);
  }
  return pwEqual(stored, String(password));   // format lama (teks biasa): di-hash otomatis saat login berhasil
}
function pwValid(password) { return String(password || '').length >= PW_MIN; }

// Cabut sesi pengguna (mis. setelah password diganti/di-reset). exceptToken = sesi yang sedang dipakai, tetap hidup.
function revokeSessions(userId, exceptToken) {
  try {
    const sh = getSheet(SHEETS.SESI);
    const d = sh.getDataRange().getValues();
    const keys = [];
    for (let i = d.length - 1; i >= 1; i--) {
      if (d[i][1] === userId && String(d[i][0]) !== String(exceptToken || '')) { keys.push('sesi_' + d[i][0]); sh.deleteRow(i + 1); }
    }
    if (keys.length) CacheService.getScriptCache().removeAll(keys);
  } catch (e) { logError(e); }
}

// Jalankan SEKALI dari editor (pilih fungsi ini → Run). Aman diulang. Pastikan Sheet sudah disalin sebagai cadangan.
function migrasiHashPassword() {
  const sh = getSheet(SHEETS.USERS);
  const d = sh.getDataRange().getValues();
  const lemah = ['admin123', 'yayasan123', 'akun123', 'pic123', '123456', 'password', '12345678', '123456789', 'qwerty'];
  let diubah = 0, sudah = 0; const perluGanti = [];
  for (let i = 1; i < d.length; i++) {
    const pw = String(d[i][2]);
    if (!pw) continue;
    if (pwIsHashed(pw)) { sudah++; continue; }
    if (lemah.indexOf(pw.toLowerCase()) >= 0 || pw.length < PW_MIN) perluGanti.push(d[i][1]);
    sh.getRange(i + 1, 3).setValue(pwMake(pw));
    diubah++;
  }
  Logger.log('Selesai. Di-hash: ' + diubah + ' akun. Sudah ter-hash sebelumnya: ' + sudah + '.');
  Logger.log(perluGanti.length ? 'SEGERA GANTI password akun ini (lemah/bawaan): ' + perluGanti.join(', ') : 'Tidak ada password bawaan/lemah yang terdeteksi.');
}

// ============================================================
//  AUTH
// ============================================================

function login(p) {
  const username = String(p.username || '').trim().toLowerCase();
  const password = String(p.password || '');
  if (!username || !password) return { ok: false, error: 'Username & password wajib diisi' };

  // Batasi tebak-tebakan password: 5x salah per username → tahan 10 menit
  const cache = CacheService.getScriptCache();
  const gKey = 'gagal_' + username;
  const gagal = parseInt(cache.get(gKey) || '0', 10);
  if (gagal >= 5) return { ok: false, error: 'Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.' };

  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]).trim().toLowerCase() === username && pwCheck(row[2], password)) {
      if (String(row[6]).toUpperCase() !== 'YA') return { ok: false, error: 'Akun tidak aktif' };
      cache.remove(gKey);
      if (!pwIsHashed(row[2])) {   // upgrade otomatis dari teks biasa ke hash
        try { withLock(function() { const r = getSheet(SHEETS.USERS); const dd = r.getDataRange().getValues();
          for (let k = 1; k < dd.length; k++) if (dd[k][0] === row[0] && !pwIsHashed(dd[k][2])) { r.getRange(k + 1, 3).setValue(pwMake(password)); break; } }); }
        catch (e) { logError(e); }
      }
      logActivity(row[0], 'login', '');
      const token = Utilities.getUuid();
      let tercatat = false;
      for (let k = 0; k < 3 && !tercatat; k++) {
        try { getSheet(SHEETS.SESI).appendRow([token, row[0], new Date()]); SpreadsheetApp.flush(); tercatat = true; }
        catch (e) { if (k === 2) logError(e); else Utilities.sleep(500 * (k + 1)); }
      }
      if (!tercatat) return { ok: false, error: 'Server Google sedang sibuk, sesi belum tercatat. Coba masuk lagi.' };
      try {
        CacheService.getScriptCache().put('sesi_' + token, JSON.stringify({ id: row[0], username: row[1], nama: row[3],
          role: String(row[4]).toLowerCase(), dapur: row[5] || '' }), 600);
      } catch (e) {}
      return { ok: true, data: { token: token,
        user: { id: row[0], username: row[1], nama: row[3], role: String(row[4]).toLowerCase(), dapur: row[5] || null } } };
    }
  }
  cache.put(gKey, String(gagal + 1), 600);
  return { ok: false, error: 'Username atau password salah' };
}

// ============================================================
//  PERIODE
// ============================================================

function readAllPeriode(dapurId) {
  const sheet = getSheet(SHEETS.SETUP);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (dapurId && data[i][1] !== dapurId) continue;
    rows.push({
      _rowIndex: i + 1, id: data[i][0], dapur: data[i][1],
      periode_no: Number(data[i][2]) || 0,
      tanggal_mulai: formatDate(data[i][3]), tanggal_akhir: formatDate(data[i][4]),
      penerima: Number(data[i][5]) || 0,
      saldoVA: Number(data[i][6]) || 0, saldoPettyAwal: Number(data[i][7]) || 0,
      status: String(data[i][8] || 'AKTIF').toUpperCase(),
    });
  }
  return rows;
}

function getPeriodeList(p) {
  const role = String(p.role || '').toLowerCase();
  let targetDapur = [];
  if (role === 'akuntan' || role === 'pic') targetDapur = [p.dapur];
  else targetDapur = p.scope && p.scope !== 'ALL' ? [p.scope] : getDapur().data.map(d => d.id);
  const all = readAllPeriode(null).filter(r => targetDapur.indexOf(r.dapur) >= 0);
  all.sort((a, b) => (a.tanggal_mulai < b.tanggal_mulai ? 1 : -1));
  return { ok: true, data: all };
}

function getActivePeriode(p) {
  if (!p.dapur) return { ok: false, error: 'dapur wajib' };
  const all = readAllPeriode(p.dapur);
  const active = all.find(r => r.status === 'AKTIF');
  if (!active) return { ok: true, data: null };

  const pettyTopups = readPettyTopups(p.dapur, active.id);
  const vaTopups = readVATopups(p.dapur, active.id);
  active.totalPettyTopup = pettyTopups.reduce((s, t) => s + t.jumlah, 0);
  active.totalVATopup = vaTopups.reduce((s, t) => s + t.jumlah, 0);
  active.pettyTopupCount = pettyTopups.length;
  active.vaTopupCount = vaTopups.length;
  active.saldoPettyTotal = active.saldoPettyAwal + active.totalPettyTopup;

  const transaksi = readAllTransaksi([p.dapur], active.id);
  active.pengeluaranVA = transaksi.filter(t => t.sumber === 'VA').reduce((s, t) => s + nilaiLPDH(t), 0);
  active.pengeluaranPetty = transaksi.filter(t => t.sumber === 'Petty Cash').reduce((s, t) => s + t.riil, 0);

  // Petty diambil dari VA → kurangi VA dengan total petty topup
  active.saldoVATotal = active.saldoVA + active.totalVATopup;
  active.sisaVA = active.saldoVATotal - active.pengeluaranVA - active.totalPettyTopup;
  active.sisaPetty = active.saldoPettyTotal - active.pengeluaranPetty;
  active.sisaTotal = active.sisaVA + active.sisaPetty;

  return { ok: true, data: active };
}

function findPeriodeCoveringDate(dapur, tanggal) {
  const all = readAllPeriode(dapur);
  return all.find(r => r.status === 'AKTIF' && String(tanggal) >= r.tanggal_mulai && String(tanggal) <= r.tanggal_akhir);
}

function addPeriode(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.dapur || !p.tanggal_mulai || !p.tanggal_akhir) return { ok: false, error: 'Field wajib kosong' };
  if (String(p.tanggal_mulai) >= String(p.tanggal_akhir)) return { ok: false, error: 'Tanggal mulai harus sebelum tanggal akhir' };

  const existing = readAllPeriode(p.dapur);
  if (existing.some(r => r.status === 'AKTIF')) return { ok: false, error: 'Masih ada periode AKTIF. Tutup periode sebelumnya dulu.' };
  for (const r of existing) {
    if (!(String(p.tanggal_akhir) < r.tanggal_mulai || String(p.tanggal_mulai) > r.tanggal_akhir)) {
      return { ok: false, error: 'Rentang tanggal overlap dengan Periode ' + r.periode_no };
    }
  }
  const nextNo = existing.reduce((m, r) => Math.max(m, r.periode_no), 0) + 1;
  const id = idUnik('PR');
  getSheet(SHEETS.SETUP).appendRow([
    id, p.dapur, nextNo, p.tanggal_mulai, p.tanggal_akhir,
    Number(p.penerima) || 0, Number(p.saldoVA) || 0, Number(p.saldoPettyAwal) || 0,
    'AKTIF', new Date(), p.user_id || '', '', ''
  ]);
  logActivity(p.user_id, 'addPeriode', id);
  return { ok: true, data: { id: id, periode_no: nextNo } };
}

function updatePeriode(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  const sheet = getSheet(SHEETS.SETUP);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      if (p.dapur && data[i][1] !== p.dapur) return { ok: false, error: 'Bukan periode dapur Anda' };
      if (String(data[i][8]).toUpperCase() !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup' };
      if (p.tanggal_mulai && p.tanggal_akhir && String(p.tanggal_mulai) >= String(p.tanggal_akhir)) {
        return { ok: false, error: 'Tanggal mulai harus sebelum tanggal akhir' };
      }
      // Ubah saldo awal VA: alasan wajib, VA tersedia tidak boleh jadi minus, tercatat di Log
      const saldoLama = Number(data[i][6]) || 0;
      const saldoBaru = p.saldoVA !== undefined && p.saldoVA !== '' ? Number(p.saldoVA) : saldoLama;
      if (isNaN(saldoBaru) || saldoBaru < 0) return { ok: false, error: 'Saldo awal VA tidak valid' };
      const saldoBerubah = saldoBaru !== saldoLama;
      if (saldoBerubah) {
        if (!String(p.alasan || '').trim()) return { ok: false, error: 'Alasan perubahan saldo awal VA wajib diisi' };
        const per = readAllPeriode(data[i][1]).find(r => r.id === p.id);
        const va = computeVA(data[i][1], per);
        const tersediaBaru = va.tersedia + (saldoBaru - saldoLama);
        if (tersediaBaru < 0) return { ok: false, error: 'Saldo awal terlalu kecil: VA tersedia akan minus ' + rupiah(-tersediaBaru) + ' (sudah terpakai/disetujui ' + rupiah(saldoLama - va.tersedia) + ').' };
      }
      const row = i + 1;
      if (p.tanggal_mulai)                sheet.getRange(row, 4).setValue(p.tanggal_mulai);
      if (p.tanggal_akhir)                sheet.getRange(row, 5).setValue(p.tanggal_akhir);
      if (p.penerima !== undefined)       sheet.getRange(row, 6).setValue(Number(p.penerima) || 0);
      if (saldoBerubah)                   sheet.getRange(row, 7).setValue(saldoBaru);
      if (p.saldoPettyAwal !== undefined) sheet.getRange(row, 8).setValue(Number(p.saldoPettyAwal) || 0);
      sheet.getRange(row, 12).setValue(new Date());
      sheet.getRange(row, 13).setValue(p.user_id || '');
      logActivity(p.user_id, 'updatePeriode', p.id);
      if (saldoBerubah) logActivity(p.user_id, 'ubahSaldoAwalVA', p.id + ': ' + rupiah(saldoLama) + ' -> ' + rupiah(saldoBaru) + ' | ' + String(p.alasan).trim());
      return { ok: true };
    }
  }
  return { ok: false, error: 'Periode tidak ditemukan' };
}

function closePeriode(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  const sheet = getSheet(SHEETS.SETUP);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      if (String(data[i][8]).toUpperCase() !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup' };
      sheet.getRange(i + 1, 9).setValue('DITUTUP');
      sheet.getRange(i + 1, 12).setValue(new Date());
      sheet.getRange(i + 1, 13).setValue(p.user_id || '');
      logActivity(p.user_id, 'closePeriode', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Periode tidak ditemukan' };
}

// Admin only: hapus periode + cascade (transaksi & top-up terkait)
function deletePeriode(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  const ss = getSS();

  // 1. Cek periode ada & hitung jumlah data terkait (untuk laporan)
  const setupSheet = ss.getSheetByName(SHEETS.SETUP);
  const setupData = setupSheet.getDataRange().getValues();
  let setupRow = -1, periodeNo = '';
  for (let i = 1; i < setupData.length; i++) {
    if (setupData[i][0] === p.id) { setupRow = i + 1; periodeNo = setupData[i][2]; break; }
  }
  if (setupRow < 0) return { ok: false, error: 'Periode tidak ditemukan' };

  // 2. Hapus transaksi yang punya periode_id ini (kolom ke-14 / index 13)
  let txDeleted = 0;
  const txSheet = ss.getSheetByName(SHEETS.TRANSAKSI);
  const txData = txSheet.getDataRange().getValues();
  for (let i = txData.length - 1; i >= 1; i--) {
    if (txData[i][13] === p.id) { txSheet.deleteRow(i + 1); txDeleted++; }
  }

  // 3. Hapus VA top-up (kolom periode_id index 2)
  let vaDeleted = 0;
  const vaSheet = ss.getSheetByName(SHEETS.VA);
  const vaData = vaSheet.getDataRange().getValues();
  for (let i = vaData.length - 1; i >= 1; i--) {
    if (vaData[i][2] === p.id) { vaSheet.deleteRow(i + 1); vaDeleted++; }
  }

  // 4. Hapus Petty top-up (kolom periode_id index 2)
  let pettyDeleted = 0;
  const pettySheet = ss.getSheetByName(SHEETS.PETTY);
  const pettyData = pettySheet.getDataRange().getValues();
  for (let i = pettyData.length - 1; i >= 1; i--) {
    if (pettyData[i][2] === p.id) { pettySheet.deleteRow(i + 1); pettyDeleted++; }
  }

  // 5. Hapus baris periode itu sendiri
  setupSheet.deleteRow(setupRow);

  logActivity(p.user_id, 'deletePeriode', p.id + ' (tx:' + txDeleted + ' va:' + vaDeleted + ' petty:' + pettyDeleted + ')');
  return { ok: true, data: { periode_no: periodeNo, txDeleted: txDeleted, vaDeleted: vaDeleted, pettyDeleted: pettyDeleted } };
}

// ============================================================
//  PETTY CASH TOP-UP (validasi: sisa VA cukup)
// ============================================================

function readPettyTopups(dapur, periode_id) {
  const sheet = getSheet(SHEETS.PETTY);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (dapur && data[i][1] !== dapur) continue;
    if (periode_id && data[i][2] !== periode_id) continue;
    rows.push({
      id: data[i][0], dapur: data[i][1], periode_id: data[i][2],
      tanggal: formatDate(data[i][3]), jumlah: Number(data[i][4]) || 0,
      keterangan: data[i][5] || '', created_at: formatDate(data[i][6]), created_by: data[i][7],
    });
  }
  return rows;
}

function getPettyTopups(p) {
  if (!p.dapur) return { ok: false, error: 'dapur wajib' };
  const rows = readPettyTopups(p.dapur, p.periode_id || null);
  rows.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
  return { ok: true, data: rows };
}

function addPettyTopup(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.dapur || !p.tanggal || !p.jumlah) return { ok: false, error: 'Field wajib kosong' };
  const periode = findPeriodeCoveringDate(p.dapur, p.tanggal);
  if (!periode) return { ok: false, error: 'Tanggal di luar periode aktif' };

  // Validasi sisa VA cukup (petty diambil dari VA)
  const vaTopups = readVATopups(p.dapur, periode.id);
  const existingPetty = readPettyTopups(p.dapur, periode.id);
  const transaksi = readAllTransaksi([p.dapur], periode.id);
  const saldoVATotal = periode.saldoVA + vaTopups.reduce((s,t)=>s+t.jumlah,0);
  const pengeluaranVA = transaksi.filter(t=>t.sumber==='VA').reduce((s,t)=>s+nilaiLPDH(t),0);
  const existingPettyTotal = existingPetty.reduce((s,t)=>s+t.jumlah,0);
  const sisaVA = saldoVATotal - pengeluaranVA - existingPettyTotal;
  if (Number(p.jumlah) > sisaVA) {
    return { ok: false, error: 'Saldo VA tidak cukup. Sisa VA: Rp ' + new Intl.NumberFormat('id-ID').format(sisaVA) };
  }

  const id = idUnik('PT');
  getSheet(SHEETS.PETTY).appendRow([id, p.dapur, periode.id, p.tanggal,
    Number(p.jumlah) || 0, p.keterangan || '', new Date(), p.user_id || '']);
  logActivity(p.user_id, 'addPettyTopup', id);
  return { ok: true, data: { id: id, periode_id: periode.id } };
}

// ============================================================
//  VA TOP-UP
// ============================================================

function readVATopups(dapur, periode_id) {
  const sheet = getSheet(SHEETS.VA);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (dapur && data[i][1] !== dapur) continue;
    if (periode_id && data[i][2] !== periode_id) continue;
    rows.push({
      id: data[i][0], dapur: data[i][1], periode_id: data[i][2],
      tanggal: formatDate(data[i][3]), jumlah: Number(data[i][4]) || 0,
      keterangan: data[i][5] || '', created_at: formatDate(data[i][6]), created_by: data[i][7],
      no_sp2d: String(data[i][8] || ''), no_kuitansi: String(data[i][9] || ''), bukti_url: String(data[i][10] || ''), _row: i + 1,
    });
  }
  return rows;
}

function getVATopups(p) {
  if (!p.dapur) return { ok: false, error: 'dapur wajib' };
  const rows = readVATopups(p.dapur, p.periode_id || null);
  rows.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
  return { ok: true, data: rows };
}

function addVATopup(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.dapur || !p.tanggal || !p.jumlah) return { ok: false, error: 'Field wajib kosong' };
  const periode = findPeriodeCoveringDate(p.dapur, p.tanggal);
  if (!periode) return { ok: false, error: 'Tanggal di luar periode aktif' };
  const id = idUnik('VT');
  const bukti = String(p.bukti_url || '').trim();
  if (bukti && !/^https:\/\//.test(bukti)) return { ok: false, error: 'Link bukti terima harus diawali https://' };
  getSheet(SHEETS.VA).appendRow([id, p.dapur, periode.id, p.tanggal,
    Number(p.jumlah) || 0, p.keterangan || '', new Date(), p.user_id || '',
    teksSel(p.no_sp2d || ''), teksSel(p.no_kuitansi || ''), bukti]);
  logActivity(p.user_id, 'addVATopup', id);
  return { ok: true, data: { id: id, periode_id: periode.id } };
}

// ============================================================
//  TRANSAKSI
//  Schema: id | dapur_id | tanggal | no_bukti | jenis | kategori | uraian
//        | sumber | riil | unriil | bukti_url | created_at | created_by | periode_id
// ============================================================

function readAllTransaksi(targetDapur, periodeId) {
  const sheet = getSheet(SHEETS.TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (targetDapur && targetDapur.indexOf(r[1]) < 0) continue;
    if (periodeId && r[13] !== periodeId) continue;
    rows.push({
      _rowIndex: i + 1, seq: i,
      id: r[0], dapur: r[1], tanggal: formatDate(r[2]), no_bukti: r[3] || '',
      jenis: r[4], kategori: r[5], uraian: r[6], sumber: r[7],
      riil: Number(r[8]) || 0, unriil: Number(r[9]) || 0, bukti_url: r[10],
      created_at: formatTimestamp(r[11]), created_by: r[12], periode_id: r[13] || '',
      pengajuan_item_id: r[14] || '',
    });
  }
  return rows;
}

function getTransaksi(p) {
  const role = String(p.role || '').toLowerCase();
  let targetDapur = [];
  if (role === 'akuntan' || role === 'pic') targetDapur = [p.dapur];
  else targetDapur = p.scope && p.scope !== 'ALL' ? [p.scope] : getDapur().data.map(d => d.id);
  const rows = readAllTransaksi(targetDapur, p.periode_id || null);
  // Urut terbaru di atas untuk tampilan default; tie-break pakai seq (urutan input)
  rows.sort((a, b) => (a.tanggal !== b.tanggal ? (a.tanggal < b.tanggal ? 1 : -1) : b.seq - a.seq));
  return { ok: true, data: rows };
}

// Input Darurat dihapus: semua pengeluaran wajib melalui menu Pengajuan (otomatis terealisasi saat disetujui).
function addTransaksi(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  return { ok: false, error: 'Fitur Input Darurat telah dihapus. Semua pengeluaran wajib melalui menu Pengajuan.' };
}

function updateTransaksi(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  const sheet = getSheet(SHEETS.TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      // Validasi: hanya transaksi di periode aktif yang bisa diedit
      const periodeId = data[i][13];
      const dapurId = data[i][1];
      if (dapurId !== p.dapur) return { ok: false, error: 'Bukan dapur Anda' };
      const all = readAllPeriode(dapurId);
      const per = all.find(r => r.id === periodeId);
      if (!per || per.status !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup, tidak bisa edit' };

      const row = i + 1;
      if (p.no_bukti !== undefined && !nbBerubah(p.no_bukti, row)) delete p.no_bukti;
      if (p.no_bukti !== undefined) {
        const nb = siapkanNoBukti(p.no_bukti, dapurId, p.tanggal || formatDate(data[i][2]), p.id);
        if (nb.error) return { ok: false, error: nb.error };
        p.no_bukti = nb.value;
      }
      const linkId = String(data[i][14] || '');
      if (linkId && linkId.indexOf('DARURAT') !== 0) {
        // Transaksi hasil realisasi pengajuan: jenis/kategori/uraian/anggaran/sumber terkunci
        if (p.tanggal !== undefined)  sheet.getRange(row, 3).setValue(p.tanggal);
        if (p.no_bukti !== undefined) sheet.getRange(row, 4).setValue(teksSel(p.no_bukti));
        if (String(data[i][4]) === 'Operasional' && p.riil !== undefined && Number(p.riil) > 0) {
          if (isFeeLink(linkId)) {
            if (Number(p.riil) > BIAYA_ADMIN_MAX) return { ok: false, error: 'Biaya admin maksimal ' + rupiah(BIAYA_ADMIN_MAX) };
            sheet.getRange(row, 9, 1, 2).setValues([[Number(p.riil), Number(p.riil)]]);
          } else if (butuhRencanaRealisasi(String(data[i][4]), String(data[i][5]))) {
            sheet.getRange(row, 9).setValue(Number(p.riil));
          }
        }
        if (p.kategori !== undefined && p.kategori !== '' && p.kategori !== String(data[i][5])) {
          // satu-satunya kategori yang boleh diubah: "Barang Habis Pakai" lama → sub-kategori baris LPDH
          if (String(data[i][5]) !== 'Barang Habis Pakai' || SUB_BHP.indexOf(p.kategori) < 0) return { ok: false, error: 'Kategori realisasi terkunci (hanya Barang Habis Pakai yang bisa dipecah ke ' + SUB_BHP.join(' / ') + ')' };
          sheet.getRange(row, 6).setValue(p.kategori);
        }
        if (p.bukti_url !== undefined && p.bukti_url !== '') sheet.getRange(row, 11).setValue(p.bukti_url);
        logActivity(p.user_id, 'updateTransaksi(realisasi)', p.id);
        return { ok: true };
      }
      if (p.tanggal !== undefined)   sheet.getRange(row, 3).setValue(p.tanggal);
      if (p.no_bukti !== undefined)  sheet.getRange(row, 4).setValue(teksSel(p.no_bukti));
      if (p.jenis !== undefined)     sheet.getRange(row, 5).setValue(p.jenis);
      if (p.kategori !== undefined)  sheet.getRange(row, 6).setValue(p.kategori);
      if (p.uraian !== undefined)    sheet.getRange(row, 7).setValue(p.uraian);
      if (p.sumber !== undefined)    sheet.getRange(row, 8).setValue(p.sumber);
      if (p.riil !== undefined)      sheet.getRange(row, 9).setValue(Number(p.riil) || 0);
      if (p.unriil !== undefined)    sheet.getRange(row, 10).setValue(Number(p.unriil) || Number(p.riil) || 0);
      if (p.bukti_url !== undefined && p.bukti_url !== '') sheet.getRange(row, 11).setValue(p.bukti_url);
      logActivity(p.user_id, 'updateTransaksi', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Transaksi tidak ditemukan' };
}

function deleteTransaksi(p) {
  if (String(p.role || '').toLowerCase() !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  const sheet = getSheet(SHEETS.TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      const periodeId = data[i][13];
      const dapurId = data[i][1];
      if (dapurId !== p.dapur) return { ok: false, error: 'Bukan dapur Anda' };
      const all = readAllPeriode(dapurId);
      const per = all.find(r => r.id === periodeId);
      if (!per || per.status !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup, tidak bisa hapus' };

      const linkId = String(data[i][14] || '');
      sheet.deleteRow(i + 1);
      if (linkId && linkId.indexOf('DARURAT') !== 0 && !isFeeLink(linkId)) { deleteFeeTx(linkId); revertItemRealisasi(linkId); }
      logActivity(p.user_id, 'deleteTransaksi', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Transaksi tidak ditemukan' };
}

// ============================================================
//  DASHBOARD
// ============================================================

function getDashboard(p) {
  const role = String(p.role || '').toLowerCase();
  const scope = p.scope || 'ALL';
  let targetDapur = [];
  if (role === 'akuntan' || role === 'pic') {
    if (!p.dapur) return { ok: false, error: 'User tidak terhubung ke dapur' };
    targetDapur = [p.dapur];
  } else {
    targetDapur = scope === 'ALL' ? getDapur().data.map(d => d.id) : [scope];
  }

  let allPeriode = [];
  targetDapur.forEach(d => { allPeriode = allPeriode.concat(readAllPeriode(d)); });

  let activePeriode = p.periode_id
    ? allPeriode.filter(r => r.id === p.periode_id)
    : allPeriode.filter(r => r.status === 'AKTIF');

  let totalPenerima = 0, saldoVAAwal = 0, saldoPettyAwal = 0;
  const periodeIds = activePeriode.map(r => r.id);
  activePeriode.forEach(r => {
    totalPenerima += r.penerima;
    saldoVAAwal += r.saldoVA;
    saldoPettyAwal += r.saldoPettyAwal;
  });

  let totalVATopup = 0, totalPettyTopup = 0;
  const topupListVA = [], topupListPetty = [], allVA = [], allPetty = [];
  targetDapur.forEach(d => {
    readVATopups(d).forEach(t => { allVA.push(t); if (periodeIds.indexOf(t.periode_id) >= 0) { totalVATopup += t.jumlah; topupListVA.push(t); } });
    readPettyTopups(d).forEach(t => { allPetty.push(t); if (periodeIds.indexOf(t.periode_id) >= 0) { totalPettyTopup += t.jumlah; topupListPetty.push(t); } });
  });
  const saldoVATotal = saldoVAAwal + totalVATopup;
  const saldoPettyTotal = saldoPettyAwal + totalPettyTopup;

  const allTx = readAllTransaksi(targetDapur);
  const transaksi = allTx.filter(r => {
    if (periodeIds.length === 0) return false;
    return periodeIds.indexOf(r.periode_id) >= 0;
  });

  let totalRiil = 0, totalUnriil = 0, pengeluaranVA = 0, pengeluaranPetty = 0;
  const byJenisRiil = {}, byJenisUnriil = {};
  const kategoriByJenis = {};
  const byDay = {};

  transaksi.forEach(r => {
    totalRiil += r.riil;
    totalUnriil += r.unriil;
    if (r.sumber === 'VA') pengeluaranVA += nilaiLPDH(r);
    else if (r.sumber === 'Petty Cash') pengeluaranPetty += r.riil;

    byJenisRiil[r.jenis] = (byJenisRiil[r.jenis] || 0) + r.riil;
    byJenisUnriil[r.jenis] = (byJenisUnriil[r.jenis] || 0) + r.unriil;

    if (!kategoriByJenis[r.jenis]) kategoriByJenis[r.jenis] = {};
    if (!kategoriByJenis[r.jenis][r.kategori]) kategoriByJenis[r.jenis][r.kategori] = { name: r.kategori, riil: 0, unriil: 0 };
    kategoriByJenis[r.jenis][r.kategori].riil += r.riil;
    kategoriByJenis[r.jenis][r.kategori].unriil += r.unriil;

    byDay[r.tanggal] = (byDay[r.tanggal] || 0) + r.riil;
  });

  const kategoriByJenisArr = {};
  Object.keys(kategoriByJenis).forEach(j => {
    kategoriByJenisArr[j] = Object.values(kategoriByJenis[j]).sort((a,b) => b.riil - a.riil);
  });

  // Petty diambil dari VA: sisaVA = saldoVATotal - pengeluaranVA - totalPettyTopup
  const sisaVA = saldoVATotal - pengeluaranVA - totalPettyTopup;
  const sisaPetty = saldoPettyTotal - pengeluaranPetty;
  const totalDana = saldoVATotal + saldoPettyAwal; // pure injection of funds
  const sisaTotal = sisaVA + sisaPetty;
  const serap = totalDana > 0 ? (totalRiil / totalDana) * 100 : 0;
  // Selisih Anggaran = Anggaran - Aktual = unriil - riil
  const selisihAnggaran = totalUnriil - totalRiil;

  // v6: komitmen = item pengajuan DISETUJUI yang belum terealisasi (tunggakan lama)
  let komitmen = 0, komitmenCount = 0, menungguCount = 0, menungguNominal = 0, daruratCount = 0;
  try {
    readAllItems().forEach(it => {
      if (targetDapur.indexOf(it.dapur) < 0 || periodeIds.indexOf(it.periode_id) < 0) return;
      if (it.status === 'DISETUJUI') { komitmen += it.nominal + (it.biaya_admin || 0); komitmenCount++; }
      if (it.status === 'DIAJUKAN' || (role !== 'pic' && role !== 'yayasan' && it.status === 'MENUNGGU_ADMIN')) { menungguNominal += it.nominal + (it.biaya_admin || 0); menungguCount++; }
    });
  } catch (e) { /* sheet pengajuan belum ada */ }
  transaksi.forEach(r => { if (String(r.pengajuan_item_id).indexOf('DARURAT') === 0) daruratCount++; });

  let periodeInfo = null;
  if (activePeriode.length === 1) {
    const r = activePeriode[0];
    periodeInfo = { id: r.id, periode_no: r.periode_no, tanggal_mulai: r.tanggal_mulai, tanggal_akhir: r.tanggal_akhir, status: r.status };
  } else if (activePeriode.length > 1) {
    periodeInfo = { multi: true, count: activePeriode.length };
  }

  // Hitung sinkronisasi saldo akhir periode sebelumnya di memori (0 pembacaan sheet tambahan)
  let saldoSync = null;
  if (targetDapur.length === 1) {
    const aktifP = allPeriode.find(r => r.status === 'AKTIF') || null;
    const prevP = allPeriode.filter(r => r.status !== 'AKTIF' && (!aktifP || r.periode_no < aktifP.periode_no))
      .sort((a, b) => b.periode_no - a.periode_no)[0] || null;
    if (prevP) {
      let keluarVA = 0, keluarLpdh = 0, keluarPetty = 0, topupVA = 0, topupPetty = 0;
      allVA.forEach(t => { if (t.periode_id === prevP.id) topupVA += (Number(t.jumlah) || 0); });
      allPetty.forEach(t => { if (t.periode_id === prevP.id) topupPetty += (Number(t.jumlah) || 0); });
      allTx.forEach(t => {
        if (t.periode_id !== prevP.id) return;
        if (t.sumber === 'VA') { keluarVA += (Number(t.riil) || 0); keluarLpdh += nilaiLPDH(t); }
        else if (t.sumber === 'Petty Cash') keluarPetty += (Number(t.riil) || 0);
      });
      const masukVA = Number(prevP.saldoVA || 0) + topupVA - topupPetty;
      const akhir = { va: masukVA - keluarVA, vaLpdh: masukVA - keluarLpdh, petty: Number(prevP.saldoPettyAwal || 0) + topupPetty - keluarPetty };
      const awal = aktifP ? { va: Number(aktifP.saldoVA || 0), petty: Number(aktifP.saldoPettyAwal || 0) } : null;
      const beda = Math.abs(akhir.va - akhir.vaLpdh) >= 1;
      const acuanVA = awal && beda && Math.abs(awal.va - akhir.vaLpdh) < Math.abs(awal.va - akhir.va) ? akhir.vaLpdh : akhir.va;
      saldoSync = { aktif: aktifP, prev: prevP, akhir: akhir, awal: awal, beda: beda,
        selisihVA: awal ? awal.va - acuanVA : 0, selisihPetty: awal ? awal.petty - akhir.petty : 0 };
    }
  }
  const periodeListSorted = allPeriode.slice().sort((a, b) => (a.tanggal_mulai < b.tanggal_mulai ? 1 : -1));

  return {
    ok: true,
    data: {
      periode: periodeInfo,
      periodeList: periodeListSorted,
      saldoSync: saldoSync,
      hasActivePeriode: activePeriode.length > 0,
      kpi: {
        penerima: totalPenerima,
        saldoVAAwal: saldoVAAwal, totalVATopup: totalVATopup, saldoVATotal: saldoVATotal,
        sisaVA: sisaVA, pengeluaranVA: pengeluaranVA,
        saldoPettyAwal: saldoPettyAwal, totalPettyTopup: totalPettyTopup, saldoPettyTotal: saldoPettyTotal,
        sisaPetty: sisaPetty, pengeluaranPetty: pengeluaranPetty,
        totalDana: totalDana, sisaTotal: sisaTotal,
        totalRiil: totalRiil, totalUnriil: totalUnriil,
        selisihAnggaran: selisihAnggaran,
        komitmen: komitmen, komitmenCount: komitmenCount, vaTersedia: sisaVA - komitmen,
        menungguCount: menungguCount, menungguNominal: menungguNominal, daruratCount: daruratCount,
        serap: Math.round(serap * 10) / 10,
      },
      byJenisRiil: Object.keys(byJenisRiil).map(k => ({ name: k, value: byJenisRiil[k] })),
      byJenisUnriil: Object.keys(byJenisUnriil).map(k => ({ name: k, value: byJenisUnriil[k] })),
      kategoriByJenis: kategoriByJenisArr,
      byDay: Object.keys(byDay).sort().map(k => ({ tanggal: k, value: byDay[k] })),
      topupListVA: topupListVA, topupListPetty: topupListPetty,
    }
  };
}

// ============================================================
//  PROFILE (self-edit)
// ============================================================

function getMyProfile(p) {
  if (!p.user_id) return { ok: false, error: 'user_id wajib' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.user_id) {
      return { ok: true, data: { id: data[i][0], username: data[i][1], nama: data[i][3], role: data[i][4], dapur: data[i][5] } };
    }
  }
  return { ok: false, error: 'User tidak ditemukan' };
}

function updateMyProfile(p) {
  if (!p.user_id) return { ok: false, error: 'user_id wajib' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.user_id) {
      const row = i + 1;
      // Untuk ganti password, password lama harus benar
      if (p.password_baru) {
        if (!p.password_lama || !pwCheck(data[i][2], p.password_lama)) {
          return { ok: false, error: 'Password lama salah' };
        }
        if (!pwValid(p.password_baru)) return { ok: false, error: 'Password baru minimal ' + PW_MIN + ' karakter' };
        sheet.getRange(row, 3).setValue(pwMake(p.password_baru));
        revokeSessions(p.user_id, p.token);   // perangkat lain harus login ulang; sesi ini tetap
      }
      if (p.nama && p.nama !== data[i][3]) sheet.getRange(row, 4).setValue(p.nama);
      if (p.username && p.username !== data[i][1]) {
        const newUname = String(p.username).toLowerCase().trim();
        // Cek unik
        for (let j = 1; j < data.length; j++) {
          if (j !== i && String(data[j][1]).toLowerCase() === newUname) return { ok: false, error: 'Username sudah dipakai' };
        }
        sheet.getRange(row, 2).setValue(newUname);
      }
      logActivity(p.user_id, 'updateMyProfile', p.user_id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'User tidak ditemukan' };
}

// ============================================================
//  USERS (admin only)
// ============================================================

function getUsers(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push({ id: data[i][0], username: data[i][1],
      nama: data[i][3], role: data[i][4], dapur: data[i][5], aktif: data[i][6] });   // password sengaja tidak dikirim
  }
  return { ok: true, data: rows };
}

function addUser(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.username || !p.password || !p.nama) return { ok: false, error: 'Lengkapi data' };
  if (!pwValid(p.password)) return { ok: false, error: 'Password minimal ' + PW_MIN + ' karakter' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const uname = String(p.username).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === uname) return { ok: false, error: 'Username sudah dipakai' };
  }
  const id = idUnik('U');
  sheet.appendRow([id, uname, pwMake(p.password), p.nama,
    String(p.target_role).toLowerCase(), p.dapur || '', 'YA']);
  logActivity(p.user_id, 'addUser', id);
  return { ok: true, data: { id: id } };
}

function updateUser(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      const row = i + 1;
      if (p.username) {
        const uname = String(p.username).toLowerCase().trim();
        for (let j = 1; j < data.length; j++) {
          if (j !== i && String(data[j][1]).toLowerCase() === uname) return { ok: false, error: 'Username sudah dipakai' };
        }
        sheet.getRange(row, 2).setValue(uname);
      }
      if (p.password) {
        if (!pwValid(p.password)) return { ok: false, error: 'Password minimal ' + PW_MIN + ' karakter' };
        sheet.getRange(row, 3).setValue(pwMake(p.password));
        revokeSessions(p.id, '');   // reset oleh admin → semua sesi pengguna itu dicabut
      }
      if (p.nama)     sheet.getRange(row, 4).setValue(p.nama);
      if (p.target_role) sheet.getRange(row, 5).setValue(String(p.target_role).toLowerCase());
      if (p.dapur !== undefined) sheet.getRange(row, 6).setValue(p.dapur || '');
      if (p.aktif)    sheet.getRange(row, 7).setValue(p.aktif);
      logActivity(p.user_id, 'updateUser', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'User tidak ditemukan' };
}

function deleteUser(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  if (p.id === p.user_id) return { ok: false, error: 'Tidak bisa hapus diri sendiri' };
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      // Cek: jangan hapus admin terakhir
      if (String(data[i][4]).toLowerCase() === 'admin') {
        let adminCount = 0;
        for (let j = 1; j < data.length; j++) {
          if (String(data[j][4]).toLowerCase() === 'admin' && String(data[j][6]).toUpperCase() === 'YA') adminCount++;
        }
        if (adminCount <= 1) return { ok: false, error: 'Tidak bisa hapus admin terakhir' };
      }
      sheet.deleteRow(i + 1);
      logActivity(p.user_id, 'deleteUser', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'User tidak ditemukan' };
}

// ============================================================
//  DAPUR (admin CRUD)
// ============================================================

function getDapur() {
  const sheet = getSheet(SHEETS.DAPUR);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) rows.push({ id: data[i][0], nama: data[i][1], alamat: data[i][2] || '', kode: data[i][3] || '',
    telepon: String(data[i][4] || ''), email: String(data[i][5] || '') });
  return { ok: true, data: rows };
}

function addDapur(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.nama) return { ok: false, error: 'Nama dapur wajib' };
  const sheet = getSheet(SHEETS.DAPUR);
  // Auto-generate ID: D + next number
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][0]).match(/^D(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const id = 'D' + String(maxNum + 1).padStart(3, '0');
  sheet.appendRow([id, p.nama, p.alamat || '', String(p.kode || '').toUpperCase().trim(), "'" + String(p.telepon || '').trim(), String(p.email || '').trim()]);
  logActivity(p.user_id, 'addDapur', id);
  return { ok: true, data: { id: id } };
}

function updateDapur(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.id || !p.nama) return { ok: false, error: 'id & nama wajib' };
  const sheet = getSheet(SHEETS.DAPUR);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      sheet.getRange(i + 1, 2).setValue(p.nama);
      if (p.alamat !== undefined) sheet.getRange(i + 1, 3).setValue(p.alamat);
      if (p.kode !== undefined) sheet.getRange(i + 1, 4).setValue(String(p.kode || '').toUpperCase().trim());
      if (p.telepon !== undefined) sheet.getRange(i + 1, 5).setValue("'" + String(p.telepon || '').trim());
      if (p.email !== undefined) sheet.getRange(i + 1, 6).setValue(String(p.email || '').trim());
      logActivity(p.user_id, 'updateDapur', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Dapur tidak ditemukan' };
}

// Identitas dapur (nama, alamat, telepon, email) — dilengkapi akuntan untuk dapurnya sendiri; dipakai di kop.
// Kode SPPG tidak bisa diubah akuntan karena dipakai di nomor Berita Acara.
function updateIdentitasDapur(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  let dapurId;
  if (me.role === 'akuntan') dapurId = me.dapur;
  else if (me.role === 'admin') dapurId = String(p.id || '');
  else return { ok: false, error: 'Hanya akuntan atau admin' };
  const nama = String(p.nama || '').trim();
  if (!nama) return { ok: false, error: 'Nama dapur wajib diisi' };
  if (nama.length > 60) return { ok: false, error: 'Nama dapur maksimal 60 karakter' };
  const alamat = String(p.alamat || '').trim();
  if (alamat.length > 200) return { ok: false, error: 'Alamat maksimal 200 karakter' };
  const telepon = String(p.telepon || '').trim();
  if (telepon && !/^[0-9+()\-\s]{6,20}$/.test(telepon)) return { ok: false, error: 'Nomor telepon tidak valid' };
  const email = String(p.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Email tidak valid' };
  const sheet = getSheet(SHEETS.DAPUR);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === dapurId) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[nama, alamat]]);
      sheet.getRange(i + 1, 5, 1, 2).setValues([["'" + telepon, email]]);
      logActivity(me.id, 'updateIdentitasDapur', dapurId + ': ' + data[i][1] + ' -> ' + nama);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Dapur tidak ditemukan' };
}

function deleteDapur(p) {
  if (String(p.role || '').toLowerCase() !== 'admin') return { ok: false, error: 'Hanya admin' };
  if (!p.id) return { ok: false, error: 'id wajib' };
  // Cek apakah masih ada user/transaksi referensi
  const usersSheet = getSheet(SHEETS.USERS);
  const usersData = usersSheet.getDataRange().getValues();
  for (let i = 1; i < usersData.length; i++) {
    if (usersData[i][5] === p.id) return { ok: false, error: 'Masih ada user di dapur ini. Pindahkan dulu.' };
  }
  const txSheet = getSheet(SHEETS.TRANSAKSI);
  const txData = txSheet.getDataRange().getValues();
  for (let i = 1; i < txData.length; i++) {
    if (txData[i][1] === p.id) return { ok: false, error: 'Masih ada transaksi di dapur ini. Tidak bisa hapus.' };
  }
  const sheet = getSheet(SHEETS.DAPUR);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      sheet.deleteRow(i + 1);
      logActivity(p.user_id, 'deleteDapur', p.id);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Dapur tidak ditemukan' };
}

// ============================================================
//  UPLOAD
// ============================================================

function uploadBukti(p) {
  if (!p.fileData || !p.fileName) return { ok: false, error: 'fileData & fileName wajib' };
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const decoded = Utilities.base64Decode(p.fileData);
  const blob = Utilities.newBlob(decoded, p.mimeType || 'application/octet-stream', p.fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, data: { url: file.getUrl(), id: file.getId() } };
}

// ============================================================
//  v6 — SESI (verifikasi token di server)
//  Role & dapur diambil dari sheet Users, BUKAN dari parameter browser.
// ============================================================

const SESI_ERR = 'Sesi tidak valid atau kedaluwarsa. Silakan keluar lalu masuk lagi.';
const SESI_MAX_HARI = 30;

// Admin dapat "bertindak sebagai" akuntan/PIC/yayasan/asisten (untuk menguji): semua aturan peran itu berlaku penuh.
// Hanya akun yang di server benar-benar admin yang bisa; peran & dapur pengguna lain tidak terpengaruh. Log tetap memakai ID admin.
const PERAN_SEBAGAI = ['akuntan', 'pic', 'aslap', 'yayasan', 'asisten'];
function authUser(p) {
  const me = authUserAsli(p);
  if (!me || me.role !== 'admin' || !p.sebagai || PERAN_SEBAGAI.indexOf(String(p.sebagai)) < 0) return me;
  const peran = String(p.sebagai);
  const perluDapur = peran === 'akuntan' || peran === 'pic' || peran === 'aslap';
  const dapur = perluDapur ? String(p.sebagai_dapur || '') : '';
  if (perluDapur && !dapur) return me;
  return Object.assign({}, me, { role: peran, dapur: dapur, sebagai: true });
}
function authUserAsli(p) {
  const token = String(p.token || '');
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sesi_' + token);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  let userId = null, createdAt = null;
  for (let coba = 0; coba < 2 && !userId; coba++) {
    if (coba) Utilities.sleep(1000);   // sesi yang baru dibuat kadang belum terbaca → baca ulang sekali
    const sesi = getSheet(SHEETS.SESI).getDataRange().getValues();
    for (let i = sesi.length - 1; i >= 1; i--) {
      if (String(sesi[i][0]) === token) { userId = sesi[i][1]; createdAt = sesi[i][2]; break; }
    }
  }
  if (!userId) return null;
  if (createdAt instanceof Date && (new Date() - createdAt) > SESI_MAX_HARI * 86400000) return null;

  const users = getSheet(SHEETS.USERS).getDataRange().getValues();
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === userId) {
      if (String(users[i][6]).toUpperCase() !== 'YA') return null;
      const me = { id: users[i][0], username: users[i][1], nama: users[i][3],
        role: String(users[i][4]).toLowerCase(), dapur: users[i][5] || '' };
      cache.put('sesi_' + token, JSON.stringify(me), 600); // 10 menit
      return me;
    }
  }
  return null;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ID unik: waktu (mudah diurutkan/dibaca) + 8 karakter acak UUID — dua permintaan di detik yang sama tidak bertabrakan
function idUnik(awalan) { return awalan + nowStamp() + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8); }
function nowStamp() { return Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMddHHmmss'); }
function todayStr() { return Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd'); }
function rupiah(n) { return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0)); }

// ============================================================
//  v6 — PENERIMA (daftar tujuan transfer, dipakai bersama 4 SPPG)
//  Schema: id | nama | bank | no_rek | aktif | created_at | created_by | updated_at | updated_by
// ============================================================

function readPenerima() {
  const data = getSheet(SHEETS.PENERIMA).getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ _row: i + 1, id: data[i][0], nama: String(data[i][1] || ''), bank: String(data[i][2] || ''),
      no_rek: String(data[i][3] || ''), aktif: String(data[i][4] || 'YA').toUpperCase() !== 'TIDAK' });
  }
  return rows;
}

function getPenerima(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const rows = readPenerima().map(r => ({ id: r.id, nama: r.nama, bank: r.bank, no_rek: r.no_rek, aktif: r.aktif }));
  rows.sort((a, b) => a.nama.localeCompare(b.nama));
  return { ok: true, data: rows };
}

function savePenerima(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan' && me.role !== 'asisten') return { ok: false, error: 'Hanya akuntan atau asisten' };
  const nama = String(p.nama || '').trim();
  const bank = String(p.bank || '').trim();
  const noRek = String(p.no_rek || '').replace(/[\s.-]/g, '');
  if (!nama || !bank || !noRek) return { ok: false, error: 'Nama, bank, dan nomor rekening wajib diisi' };
  if (!/^\d{5,20}$/.test(noRek)) return { ok: false, error: 'Nomor rekening harus 5–20 digit angka' };

  return withLock(function() {
    const sheet = getSheet(SHEETS.PENERIMA);
    const all = readPenerima();
    const dup = all.find(r => r.nama.toLowerCase() === nama.toLowerCase() && r.id !== p.id);
    if (dup) return { ok: false, error: 'Nama penerima "' + nama + '" sudah ada di daftar' };

    if (p.id) {
      const cur = all.find(r => r.id === p.id);
      if (!cur) return { ok: false, error: 'Penerima tidak ditemukan' };
      sheet.getRange(cur._row, 2, 1, 3).setValues([[nama, bank, "'" + noRek]]);
      sheet.getRange(cur._row, 8, 1, 2).setValues([[new Date(), me.id]]);
      const rekBerubah = cur.bank !== bank || cur.no_rek !== noRek;
      logActivity(me.id, rekBerubah ? 'ubahRekeningPenerima' : 'updatePenerima',
        p.id + (rekBerubah ? ' (' + cur.bank + ' ' + cur.no_rek + ' → ' + bank + ' ' + noRek + ')' : ''));
      return { ok: true, data: { id: p.id, nama: nama, bank: bank, no_rek: noRek } };
    }
    const id = idUnik('PN');
    sheet.appendRow([id, nama, bank, "'" + noRek, 'YA', new Date(), me.id, '', '']);
    logActivity(me.id, 'addPenerima', id);
    return { ok: true, data: { id: id, nama: nama, bank: bank, no_rek: noRek } };
  });
}

// ============================================================
//  v6 — PENGAJUAN ANGGARAN
//  Pengajuan:     id | nomor | dapur_id | periode_id | tanggal | status | created_at | created_by | decided_at | decided_by
//  PengajuanItem: id | pengajuan_id | dapur_id | periode_id | urut | jenis | kategori | uraian | nominal
//               | penerima_id | penerima_nama | bank | no_rek | susulan | status | catatan | putaran
//               | decided_at | decided_by | transaksi_id | created_at | updated_at
//  Status item: DIAJUKAN → DISETUJUI / REVISI / DITOLAK → TEREALISASI ; DIBATALKAN
// ============================================================

function readAllPengajuan() {
  const data = getSheet(SHEETS.PENGAJUAN).getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ _row: i + 1, seq: i, id: data[i][0], nomor: data[i][1], dapur: data[i][2], periode_id: data[i][3],
      tanggal: formatDate(data[i][4]), status: data[i][5], created_at: formatTimestamp(data[i][6]), created_by: data[i][7],
      decided_at: formatTimestamp(data[i][8]), decided_by: data[i][9] || '' });
  }
  return rows;
}

function readAllItems() {
  const data = getSheet(SHEETS.PITEM).getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    const nom = Number(r[8]) || 0;
    const rr = Number(r[25]) || 0;
    rows.push({ _row: i + 1, id: r[0], pengajuan_id: r[1], dapur: r[2], periode_id: r[3], urut: Number(r[4]) || 0,
      jenis: r[5], kategori: r[6], uraian: r[7], nominal: nom,
      penerima_id: r[9], penerima_nama: r[10], bank: String(r[11] || ''), no_rek: String(r[12] || ''),
      susulan: String(r[13]).toUpperCase() === 'YA', status: String(r[14] || ''), catatan: r[15] || '',
      putaran: Number(r[16]) || 1, decided_at: formatTimestamp(r[17]), decided_by: r[18] || '',
      transaksi_id: r[19] || '', created_at: formatTimestamp(r[20]),
      rincian: bacaRincian(r[22]), nota_url: String(r[23] || ''), nota_no: String(r[24] || ''),
      rencana_riil: rr > 0 ? rr : nom, biaya_admin: Number(r[26]) || 0 });
  }
  return rows;
}

function deriveHeaderStatus(items) {
  const st = items.map(i => i.status);
  if (st.indexOf('MENUNGGU_ADMIN') >= 0) return 'MENUNGGU_ADMIN';
  if (st.indexOf('DIAJUKAN') >= 0) return 'MENUNGGU';
  if (st.indexOf('REVISI') >= 0) return 'REVISI';
  return 'SELESAI';
}

function refreshHeaderStatus(pengajuanId) {
  const items = readAllItems().filter(i => i.pengajuan_id === pengajuanId);
  const head = readAllPengajuan().find(h => h.id === pengajuanId);
  if (head) getSheet(SHEETS.PENGAJUAN).getRange(head._row, 6).setValue(deriveHeaderStatus(items));
}

// Sisa VA periode, komitmen (disetujui belum terealisasi / tunggakan lama), dan VA tersedia.
// Saldo VA dipotong sebesar Nilai Pengajuan (anggaran) + Biaya Admin.
function computeVA(dapur, periode, allItems) {
  const vaTopups = readVATopups(dapur, periode.id);
  const pettyTopups = readPettyTopups(dapur, periode.id);
  const transaksi = readAllTransaksi([dapur], periode.id);
  const saldoVATotal = periode.saldoVA + vaTopups.reduce((s, t) => s + t.jumlah, 0);
  const pengeluaranVA = transaksi.filter(t => t.sumber === 'VA').reduce((s, t) => s + nilaiLPDH(t), 0);
  const sisaVA = saldoVATotal - pengeluaranVA - pettyTopups.reduce((s, t) => s + t.jumlah, 0);
  const items = allItems || readAllItems();
  const komitmen = items.filter(i => i.dapur === dapur && i.periode_id === periode.id && i.status === 'DISETUJUI')
    .reduce((s, i) => s + i.nominal + (i.biaya_admin || 0), 0);
  return { periode_id: periode.id, sisaVA: sisaVA, komitmen: komitmen, tersedia: sisaVA - komitmen };
}

// Rincian per bahan (LPDH sheet B): [{ nama, kategori, volume, satuan, harga }]; jumlah = nominal baris.
const KATEGORI_BAHAN = ['Karbohidrat', 'Protein hewani', 'Protein nabati', 'Sayuran', 'Buah', 'Susu', 'Minyak dan bumbu', 'Lainnya'];
function bacaRincian(v) { if (!v) return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function cekRincian(raw, nominal) {
  let a = raw;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { return { error: 'Format rincian bahan tidak valid' }; } }
  if (!Array.isArray(a) || !a.length) return { error: 'Rincian bahan wajib diisi (nama, kategori, volume, satuan, harga satuan)' };
  if (a.length > 40) return { error: 'Rincian bahan maksimal 40 baris' };
  const bersih = [];
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {}, n = i + 1;
    const r = { nama: String(x.nama || '').trim(), kategori: String(x.kategori || ''), volume: Number(x.volume), satuan: String(x.satuan || '').trim(), harga: Number(x.harga) };
    if (!r.nama) return { error: 'Rincian ' + n + ': nama bahan wajib' };
    if (KATEGORI_BAHAN.indexOf(r.kategori) < 0) return { error: 'Rincian ' + n + ': kategori bahan tidak valid' };
    if (!(r.volume > 0)) return { error: 'Rincian ' + n + ': volume harus lebih dari 0' };
    if (!r.satuan) return { error: 'Rincian ' + n + ': satuan wajib' };
    if (!(r.harga > 0)) return { error: 'Rincian ' + n + ': harga satuan harus lebih dari 0' };
    total += r.volume * r.harga; bersih.push(r);
  }
  if (Math.abs(Math.round(total) - Number(nominal)) > 1) return { error: 'Jumlah rincian bahan (' + rupiah(total) + ') harus sama dengan nominal (' + rupiah(nominal) + ')' };
  return { value: JSON.stringify(bersih) };
}
// Nomor nota diisi saat pengajuan: kosong = nota tak bernomor (dibuat otomatis saat disetujui);
// "-" ditolak; tidak boleh sama dengan nomor bukti transaksi mana pun atau nomor nota pengajuan lain yang masih berjalan.
function cekNotaNo(raw, kecualiItemId, itemsSemua) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { value: '' };
  if (/^[\s\-\u2013\u2014_.\/]*$/.test(s)) return { error: 'Nomor nota tidak boleh "' + s + '". Kosongkan bila nota tidak bernomor.' };
  const n = normNB(s);
  const sh = getSheet(SHEETS.TRANSAKSI);
  const tampil = sh.getRange(1, 4, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  for (let i = 1; i < tampil.length; i++) if (normNB(tampil[i][0]) === n) return { error: 'Nomor nota "' + s + '" sudah dipakai transaksi lain. Bila notanya berbeda (toko lain), tambahkan kode toko, cth. ' + s + '-TOKOA.' };
  const lain = (itemsSemua || readAllItems()).find(function(it) { return it.id !== kecualiItemId && it.nota_no && normNB(it.nota_no) === n && ['DITOLAK', 'DIBATALKAN', 'TEREALISASI'].indexOf(it.status) < 0; });
  if (lain) return { error: 'Nomor nota "' + s + '" sudah dipakai pengajuan lain yang masih berjalan. Tambahkan kode toko bila notanya berbeda.' };
  return { value: s };
}
function cekNotaUrl(u) { u = String(u || '').trim(); return !u || /^https:\/\//.test(u) ? u : null; }

function validateItemInput(it, penerimaMap) {
  if (!it.jenis || !JENIS_KATEGORI[it.jenis]) return 'Jenis tidak valid';
  if (!it.kategori || JENIS_KATEGORI[it.jenis].indexOf(it.kategori) < 0) return 'Kategori tidak valid untuk ' + it.jenis;
  if (!String(it.uraian || '').trim()) return 'Uraian wajib diisi';
  if (!(Number(it.nominal) > 0)) return 'Nominal harus lebih dari 0';
  if (!it.penerima_id || !penerimaMap[it.penerima_id]) return 'Penerima belum dipilih';
  return null;
}

function createPengajuan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  let dapurId;
  if (me.role === 'akuntan') {
    if (!me.dapur) return { ok: false, error: 'Akun tidak terhubung ke dapur' };
    dapurId = me.dapur;
  } else if (me.role === 'asisten') {
    dapurId = String(p.dapur || '');
    if (!getDapur().data.some(d => d.id === dapurId)) return { ok: false, error: 'Pilih dapur tujuan pengajuan' };
  } else return { ok: false, error: 'Hanya akuntan atau asisten yang dapat membuat pengajuan' };

  let items;
  try { items = typeof p.items === 'string' ? JSON.parse(p.items) : p.items; } catch (e) { return { ok: false, error: 'Format item tidak valid' }; }
  if (!items || !items.length) return { ok: false, error: 'Minimal 1 baris pengajuan' };
  if (items.length > 50) return { ok: false, error: 'Maksimal 50 baris per pengajuan' };

  if (me.role === 'asisten' && items.some(it => it.jenis !== 'Bahan Baku')) return { ok: false, error: 'Asisten hanya dapat mengajukan Bahan Baku' };
  // Tanggal pengajuan = hari H penggunaan dana (boleh sebelum/sesudah hari input). Waktu input asli tetap di created_at.
  const tanggal = p.tanggal ? String(p.tanggal).substring(0, 10) : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Format tanggal pengajuan tidak valid' };
  const periode = findPeriodeCoveringDate(dapurId, tanggal);
  if (!periode) return { ok: false, error: 'Tanggal ' + tanggal + ' di luar periode aktif dapur ini.' };

  const penerimaMap = {};
  readPenerima().forEach(r => { penerimaMap[r.id] = r; });
  const tambahan = [];
  const semuaItem = readAllItems();
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const err = validateItemInput(it, penerimaMap);
    if (err) return { ok: false, error: 'Baris ' + (k + 1) + ': ' + err };
    let rinc = '';
    if (it.jenis === 'Bahan Baku') {
      const c = cekRincian(it.rincian, it.nominal);
      if (c.error) return { ok: false, error: 'Baris ' + (k + 1) + ': ' + c.error };
      rinc = c.value;
    }
    const perluRR = butuhRencanaRealisasi(it.jenis, it.kategori);
    const rencanaRiil = perluRR ? Math.round(Number(it.rencana_riil)) : Math.round(Number(it.nominal));
    if (perluRR && !(rencanaRiil > 0)) return { ok: false, error: 'Baris ' + (k + 1) + ': nilai rencana realisasi (aktual) wajib diisi' };
    const fee = parseFee(it.biaya_admin);
    if (fee < 0) return { ok: false, error: 'Baris ' + (k + 1) + ': biaya admin harus antara Rp 1 dan ' + rupiah(BIAYA_ADMIN_MAX) };
    const nota = cekNotaUrl(it.nota_url);
    if (nota === null) return { ok: false, error: 'Baris ' + (k + 1) + ': link nota / bukti tidak valid' };
    if (!pakaiKuitansi(it) && !nota) {
      return { ok: false, error: 'Baris ' + (k + 1) + ': ' + (it.jenis === 'Bahan Baku' ? 'foto nota Bahan Baku wajib diunggah' : 'bukti / nota pengajuan wajib diunggah') };
    }
    let notaNo = '';
    if (it.nota_no !== undefined && it.nota_no !== null && String(it.nota_no).trim() !== '') {
      const c2 = cekNotaNo(it.nota_no, null, semuaItem);
      if (c2.error) return { ok: false, error: 'Baris ' + (k + 1) + ': ' + c2.error };
      notaNo = c2.value;
      if (notaNo && tambahan.some(function(t) { return t[2] && normNB(t[2]) === normNB(notaNo); })) return { ok: false, error: 'Baris ' + (k + 1) + ': nomor nota "' + notaNo + '" dipakai dua kali di pengajuan ini' };
    }
    tambahan.push([rinc, nota, notaNo ? teksSel(notaNo) : '', rencanaRiil, fee]);
  }

  const dapurRow = getDapur().data.find(d => d.id === dapurId);
  const kode = (dapurRow && dapurRow.kode) || dapurId;

  // Idempoten: request_id yang sama (kirim ulang setelah koneksi putus) mengembalikan hasil yang sama, bukan membuat pengajuan baru
  const reqId = String(p.request_id || '').substring(0, 60);
  const reqKey = reqId ? 'req_' + me.id + '_' + reqId : '';

  return withLock(function() {
    if (reqKey) {
      const prev = CacheService.getScriptCache().get(reqKey);
      if (prev) { try { return JSON.parse(prev); } catch (e) {} }
    }
    const yyyy = tanggal.substring(0, 4), mm = tanggal.substring(5, 7);
    const prefix = 'BA-PA/' + kode + '/' + yyyy + '/' + mm + '/';
    // 1 Berita Acara per dapur per hari: pengajuan berikutnya di hari yang sama (akuntan/asisten) memakai nomor yang sama
    const heads = readAllPengajuan();
    const sameDay = heads.find(h => h.dapur === dapurId && h.tanggal === tanggal && String(h.nomor).indexOf(prefix) === 0);
    let nomor;
    if (sameDay) nomor = sameDay.nomor;
    else {
      let maxNo = 0;
      heads.forEach(h => {
        if (String(h.nomor).indexOf(prefix) === 0) maxNo = Math.max(maxNo, parseInt(String(h.nomor).substring(prefix.length), 10) || 0);
      });
      nomor = prefix + String(maxNo + 1).padStart(3, '0');
    }
    const pid = idUnik('PA');
    const now = new Date();
    const isBackdate = tanggal < todayStr();
    const initHeadStatus = isBackdate ? 'MENUNGGU_ADMIN' : 'MENUNGGU';
    const initItemStatus = isBackdate ? 'MENUNGGU_ADMIN' : 'DIAJUKAN';
    getSheet(SHEETS.PENGAJUAN).appendRow([pid, nomor, dapurId, periode.id, tanggal, initHeadStatus, now, me.id, '', '']);

    const rows = items.map(function(it, idx) {
      const pn = penerimaMap[it.penerima_id];
      return [pid + '-' + (idx + 1), pid, dapurId, periode.id, idx + 1, it.jenis, it.kategori, String(it.uraian).trim(),
        Number(it.nominal), pn.id, pn.nama, pn.bank, "'" + pn.no_rek, it.susulan ? 'YA' : 'TIDAK', initItemStatus, catatanPengaju(it.catatan), 1,
        '', '', '', now, now].concat(tambahan[idx]);
    });
    const sh = getSheet(SHEETS.PITEM);
    sh.getRange(1, 23, 1, 5).setValues([['rincian_bahan', 'nota_url', 'nota_no', 'rencana_riil', 'biaya_admin']]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    logActivity(me.id, 'createPengajuan', nomor + ' (' + rows.length + ' baris' + (isBackdate ? ', backdate menunggu ACC Admin' : '') + ')');
    const hasil = { ok: true, data: { id: pid, nomor: nomor, backdate: isBackdate } };
    if (reqKey) CacheService.getScriptCache().put(reqKey, JSON.stringify(hasil), 21600);   // 6 jam
    return hasil;
  });
}

// Catatan dari akuntan untuk Yayasan (mis. alasan melebihi pagu harian); disimpan di kolom catatan dengan awalan tetap
const AWALAN_CATATAN_AKUNTAN = 'Catatan akuntan: ';
function catatanAkuntanDari(c) { c = String(c || ''); const i = c.indexOf(AWALAN_CATATAN_AKUNTAN); return i < 0 ? '' : c.substring(i + AWALAN_CATATAN_AKUNTAN.length).trim(); }
function catatanPengaju(v) { const t = String(v || '').replace(/\s+/g, ' ').trim().substring(0, 400); return t ? AWALAN_CATATAN_AKUNTAN + t : ''; }

// Tandai penerima baru & rekening berubah dibanding pembayaran terakhir yang disetujui
function annotateItems(items, allItems) {
  const approved = allItems.filter(i => (i.status === 'DISETUJUI' || i.status === 'TEREALISASI') && i.decided_at)
    .sort((a, b) => (a.decided_at < b.decided_at ? -1 : 1));
  items.forEach(function(it) {
    const prev = approved.filter(a => a.penerima_id === it.penerima_id && a.id !== it.id &&
      (!it.decided_at || a.decided_at < it.decided_at));
    if (!prev.length) { it.penerima_baru = true; return; }
    const last = prev[prev.length - 1];
    if (last.bank !== it.bank || last.no_rek !== it.no_rek) {
      it.rek_berubah = { dari: last.bank + ' ' + last.no_rek, ke: it.bank + ' ' + it.no_rek };
    }
  });
}

function getPengajuan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  let target;
  if (me.role === 'akuntan' || me.role === 'pic') target = [me.dapur];
  else if (me.role === 'asisten') target = getDapur().data.map(d => d.id);
  else target = p.scope && p.scope !== 'ALL' ? [p.scope] : getDapur().data.map(d => d.id);

  const activeByDapur = {};
  target.forEach(d => { const a = readAllPeriode(d).find(r => r.status === 'AKTIF'); if (a) activeByDapur[d] = a; });
  const periodeFilter = p.periode_id ? [p.periode_id] : Object.keys(activeByDapur).map(d => activeByDapur[d].id);
  // Tab "Menunggu" (tanpa periode tertentu): sertakan juga pengajuan menunggu dari periode yang sudah ditutup,
  // agar baris yang tertinggal (mis. pengajuan ganda) tetap bisa ditolak.
  const semuaPeriode = p.filter === 'menunggu' && !p.periode_id;

  const allItems = readAllItems();
  let heads = readAllPengajuan().filter(h => target.indexOf(h.dapur) >= 0 && (semuaPeriode || periodeFilter.indexOf(h.periode_id) >= 0));
  if (semuaPeriode) {
    const adaMenunggu = {};
    allItems.forEach(i => { if (i.status === 'DIAJUKAN' || (me.role === 'admin' && i.status === 'MENUNGGU_ADMIN')) adaMenunggu[i.pengajuan_id] = 1; });
    heads = heads.filter(h => adaMenunggu[h.id]);
  }
  if (me.role === 'asisten') heads = heads.filter(h => h.created_by === me.id);
  const userNames = {}, userRoles = {};
  getSheet(SHEETS.USERS).getDataRange().getValues().slice(1).forEach(u => { userNames[u[0]] = u[3]; userRoles[u[0]] = String(u[4]).toLowerCase(); });

  let out = heads.map(function(h) {
    const items = allItems.filter(i => i.pengajuan_id === h.id).sort((a, b) => a.urut - b.urut);
    annotateItems(items, allItems);
    const sum = st => items.filter(i => st.indexOf(i.status) >= 0).reduce((s, i) => s + i.nominal, 0);
    return Object.assign({}, h, {
      status: deriveHeaderStatus(items),
      periode_tutup: !(activeByDapur[h.dapur] && activeByDapur[h.dapur].id === h.periode_id),
      created_by_nama: userNames[h.created_by] || h.created_by,
      decided_by_nama: userNames[h.decided_by] || h.decided_by,
      decided_by_role: userRoles[h.decided_by] || '',
      items: items.map(i => Object.assign({}, i, { decided_by_nama: userNames[i.decided_by] || i.decided_by })),
      total_diajukan: sum(['MENUNGGU_ADMIN', 'DIAJUKAN', 'DISETUJUI', 'REVISI', 'DITOLAK', 'TEREALISASI']),
      total_disetujui: sum(['DISETUJUI', 'TEREALISASI']),
    });
  });
  if (p.filter === 'menunggu') out = out.filter(h => h.status === 'MENUNGGU' || (me.role === 'admin' && h.status === 'MENUNGGU_ADMIN'));
  out.sort((a, b) => (a.tanggal !== b.tanggal ? (a.tanggal < b.tanggal ? 1 : -1) : (a.seq < b.seq ? 1 : -1)));

  const va = {};
  if (me.role !== 'asisten') Object.keys(activeByDapur).forEach(d => { va[d] = computeVA(d, activeByDapur[d], allItems); });
  const periodeAktif = {};
  const periodeRange = {};
  Object.keys(activeByDapur).forEach(d => {
    periodeAktif[d] = activeByDapur[d].id;
    periodeRange[d] = { mulai: activeByDapur[d].tanggal_mulai, akhir: activeByDapur[d].tanggal_akhir };
  });
  let baAktif = undefined;
  if (!p.periode_id && !p.filter && me.role !== 'asisten') {
    const b = getBADaftar({ token: p.token, sebagai: p.sebagai, sebagai_dapur: p.sebagai_dapur, mode: 'aktif' });
    if (b && b.ok) baAktif = (b.data || []).filter(g => g.periode_status === 'AKTIF');
  }
  return { ok: true, data: { pengajuan: out, va: va, periodeAktif: periodeAktif, periodeRange: periodeRange, baAktif: baAktif } };
}

function findItem(itemId) {
  return readAllItems().find(i => i.id === itemId);
}

// Siapa boleh mengubah baris: akuntan dapur tsb, atau asisten pembuat pengajuan (hanya sebelum disetujui)
function canModifyItem(me, it) {
  if (me.role === 'akuntan') return it.dapur === me.dapur ? null : 'Bukan dapur Anda';
  if (me.role === 'asisten') {
    const head = readAllPengajuan().find(h => h.id === it.pengajuan_id);
    if (!head || head.created_by !== me.id) return 'Bukan pengajuan Anda';
    if (it.status !== 'MENUNGGU_ADMIN' && it.status !== 'DIAJUKAN' && it.status !== 'REVISI') return 'Baris yang sudah disetujui hanya bisa diubah akuntan';
    return null;
  }
  return 'Tidak berwenang';
}

function updatePengajuanItem(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  return withLock(function() {
    const it = findItem(p.item_id);
    if (!it) return { ok: false, error: 'Baris tidak ditemukan' };
    const deny = canModifyItem(me, it);
    if (deny) return { ok: false, error: deny };
    if (it.status !== 'MENUNGGU_ADMIN' && it.status !== 'DIAJUKAN' && it.status !== 'REVISI') return { ok: false, error: 'Baris berstatus ' + it.status + ', tidak bisa diedit' };
    if (me.role === 'asisten' && p.jenis !== 'Bahan Baku') return { ok: false, error: 'Asisten hanya dapat mengajukan Bahan Baku' };
    const penerimaMap = {};
    readPenerima().forEach(r => { penerimaMap[r.id] = r; });
    const input = { jenis: p.jenis, kategori: p.kategori, uraian: p.uraian, nominal: p.nominal, penerima_id: p.penerima_id };
    const err = validateItemInput(input, penerimaMap);
    if (err) return { ok: false, error: err };
    let rinc = '';
    if (p.jenis === 'Bahan Baku') {
      const c = cekRincian(p.rincian, p.nominal);
      if (c.error) return { ok: false, error: c.error };
      rinc = c.value;
    }
    const perluRR = butuhRencanaRealisasi(p.jenis, p.kategori);
    const rrRaw = p.rencana_riil === undefined ? it.rencana_riil : p.rencana_riil;
    const rencanaRiil = perluRR ? Math.round(Number(rrRaw)) : Math.round(Number(p.nominal));
    if (perluRR && !(rencanaRiil > 0)) return { ok: false, error: 'Nilai rencana realisasi (aktual) wajib diisi' };
    const fee = parseFee(p.biaya_admin === undefined ? it.biaya_admin : p.biaya_admin);
    if (fee < 0) return { ok: false, error: 'Biaya admin harus antara Rp 1 dan ' + rupiah(BIAYA_ADMIN_MAX) };
    const nota = p.nota_url === undefined ? it.nota_url : cekNotaUrl(p.nota_url);
    if (nota === null) return { ok: false, error: 'Link nota / bukti tidak valid' };
    if (!pakaiKuitansi(input) && !nota) {
      return { ok: false, error: p.jenis === 'Bahan Baku' ? 'Foto nota Bahan Baku wajib diunggah' : 'Bukti / nota pengajuan wajib diunggah' };
    }
    let notaNo = '';
    const nnRaw = p.nota_no === undefined ? it.nota_no : p.nota_no;
    if (nnRaw !== undefined && nnRaw !== null && String(nnRaw).trim() !== '') {
      const c2 = cekNotaNo(nnRaw, it.id);
      if (c2.error) return { ok: false, error: c2.error };
      notaNo = c2.value;
    }
    const pn = penerimaMap[p.penerima_id];
    const sh = getSheet(SHEETS.PITEM);
    const wasRevisi = it.status === 'REVISI';
    const nextStatus = it.status === 'MENUNGGU_ADMIN' ? 'MENUNGGU_ADMIN' : 'DIAJUKAN';
    sh.getRange(1, 23, 1, 5).setValues([['rincian_bahan', 'nota_url', 'nota_no', 'rencana_riil', 'biaya_admin']]);
    sh.getRange(it._row, 23, 1, 5).setValues([[rinc, nota, notaNo ? teksSel(notaNo) : '', rencanaRiil, fee]]);
    sh.getRange(it._row, 6, 1, 12).setValues([[p.jenis, p.kategori, String(p.uraian).trim(), Number(p.nominal),
      pn.id, pn.nama, pn.bank, "'" + pn.no_rek, String(p.susulan) === 'true' || p.susulan === true ? 'YA' : 'TIDAK',
      nextStatus, it.catatan, wasRevisi ? it.putaran + 1 : it.putaran]]);
    if (wasRevisi) sh.getRange(it._row, 18, 1, 2).setValues([['', '']]);
    sh.getRange(it._row, 22).setValue(new Date());
    refreshHeaderStatus(it.pengajuan_id);
    logActivity(me.id, wasRevisi ? 'ajukanUlangItem' : 'updatePengajuanItem', it.id);
    return { ok: true };
  });
}

function batalkanItem(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  return withLock(function() {
    const it = findItem(p.item_id);
    if (!it) return { ok: false, error: 'Baris tidak ditemukan' };
    const deny = canModifyItem(me, it);
    if (deny) return { ok: false, error: deny };
    if (['MENUNGGU_ADMIN', 'DIAJUKAN', 'REVISI', 'DISETUJUI'].indexOf(it.status) < 0) return { ok: false, error: 'Baris berstatus ' + it.status + ', tidak bisa dibatalkan' };
    const sh = getSheet(SHEETS.PITEM);
    const alasan = String(p.alasan || '').trim();
    sh.getRange(it._row, 15, 1, 2).setValues([['DIBATALKAN', 'Dibatalkan akuntan' + (alasan ? ': ' + alasan : '') + (it.catatan ? ' | ' + it.catatan : '')]]);
    sh.getRange(it._row, 22).setValue(new Date());
    refreshHeaderStatus(it.pengajuan_id);
    logActivity(me.id, 'batalkanItem', it.id + ' (' + it.status + ')');
    return { ok: true };
  });
}

function decidePengajuan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (ROLE_PENYETUJU.indexOf(me.role) < 0) return { ok: false, error: 'Peran Anda tidak dapat menyetujui pengajuan' };
  let keputusan;
  try { keputusan = typeof p.keputusan === 'string' ? JSON.parse(p.keputusan) : p.keputusan; } catch (e) { return { ok: false, error: 'Format keputusan tidak valid' }; }
  if (!keputusan || !keputusan.length) return { ok: false, error: 'Belum ada keputusan' };

  return withLock(function() {
    const head = readAllPengajuan().find(h => h.id === p.pengajuan_id);
    if (!head) return { ok: false, error: 'Pengajuan tidak ditemukan' };
    if (me.role === 'pic' && head.dapur !== me.dapur) return { ok: false, error: 'PIC hanya dapat memutuskan pengajuan dapurnya sendiri' };
    const allItems = readAllItems();
    const pending = allItems.filter(i => i.pengajuan_id === head.id && i.status === 'DIAJUKAN');
    if (!pending.length) {
      if (allItems.some(i => i.pengajuan_id === head.id && i.status === 'MENUNGGU_ADMIN')) {
        return { ok: false, error: 'Pengajuan backdate ini masih menunggu ACC Admin sebelum dapat diputuskan PIC/Yayasan' };
      }
      return { ok: false, error: 'Tidak ada baris yang menunggu keputusan (mungkin sudah diputuskan)' };
    }

    const map = {};
    keputusan.forEach(k => { map[k.item_id] = k; });
    const periodeHead = readAllPeriode(head.dapur).find(r => r.id === head.periode_id);
    const periodeTutup = !periodeHead || periodeHead.status !== 'AKTIF';
    let totalSetuju = 0;
    const disetujuiList = [];
    for (let k = 0; k < pending.length; k++) {
      const it = pending[k], d = map[it.id];
      if (!d || ['DISETUJUI', 'REVISI', 'DITOLAK'].indexOf(d.status) < 0) return { ok: false, error: 'Baris ' + it.urut + ' belum diberi keputusan' };
      if ((d.status === 'REVISI' || d.status === 'DITOLAK') && !String(d.catatan || '').trim()) {
        return { ok: false, error: 'Baris ' + it.urut + ': catatan wajib untuk ' + d.status };
      }
      if (d.status === 'DISETUJUI') {
        if ((/melebihi pagu/i.test(String(it.catatan || '')) || String(it.catatan || '').indexOf(AWALAN_CATATAN_AKUNTAN) === 0) && !String(d.catatan || '').trim()) {
          return { ok: false, error: 'Baris ' + it.urut + ' melebihi pagu: wajib isi catatan persetujuan' };
        }
        totalSetuju += it.nominal + (it.biaya_admin || 0);
        disetujuiList.push(it);
      }
      if (periodeTutup && d.status !== 'DITOLAK') {
        return { ok: false, error: 'Baris ' + it.urut + ': periode pengajuan ini sudah ditutup — baris yang tertinggal hanya bisa ditolak' };
      }
    }

    if (totalSetuju > 0) {
      const periode = periodeHead;
      if (periodeTutup) return { ok: false, error: 'Periode pengajuan ini sudah ditutup' };
      const va = computeVA(head.dapur, periode, allItems);
      const semuaAdaCatatan = disetujuiList.every(function(it) { return !!String((map[it.id] || {}).catatan || '').trim(); });
      if (totalSetuju > va.tersedia && !semuaAdaCatatan) {
        return { ok: false, error: 'VA tersedia tidak cukup. Disetujui ' + rupiah(totalSetuju) + ', VA tersedia ' + rupiah(va.tersedia) +
          ' (sisa VA ' + rupiah(va.sisaVA) + ' − tunggakan belum terealisasi ' + rupiah(va.komitmen) + '). Wajib isi catatan persetujuan untuk tetap menyetujui.' };
      }
    }

    // Semua jenis (Bahan Baku, Operasional, Fasilitas SPPG) yang disetujui otomatis langsung terealisasi menjadi transaksi.
    // Siapkan nomor bukti & kuitansi dulu sebelum menulis apa pun ke Sheet (hindari transaksi setengah jadi bila Drive gagal).
    const now = new Date();
    const txRows = [];
    const txByItem = {};
    if (disetujuiList.length > 0) {
      const txSh = getSheet(SHEETS.TRANSAKSI);
      const txTampil = txSh.getRange(1, 4, Math.max(txSh.getLastRow(), 1), 1).getDisplayValues();
      const dipakai = {};
      for (let i = 1; i < txTampil.length; i++) if (txTampil[i][0]) dipakai[normNB(txTampil[i][0])] = 1;
      const dapur = getDapur().data.find(function(x) { return x.id === head.dapur; }) || {};
      const kode = dapur.kode || head.dapur || 'SPPG';
      const tglTx = /^\d{4}-\d{2}-\d{2}$/.test(head.tanggal) ? head.tanggal : todayStr();
      const aw = kode + '-' + tglTx.replace(/-/g, '') + '-';
      let seqNo = 0;

      for (let k = 0; k < disetujuiList.length; k++) {
        const it = disetujuiList[k];
        let nb = '';
        if (it.nota_no && !/^[\s\-\u2013\u2014_.\/]*$/.test(it.nota_no) && !(normNB(it.nota_no) in dipakai)) nb = it.nota_no;
        if (!nb) {
          do { seqNo++; nb = aw + String(seqNo).padStart(3, '0'); } while (normNB(nb) in dipakai);
        }
        dipakai[normNB(nb)] = 1;

        const riil = butuhRencanaRealisasi(it.jenis, it.kategori) ? (it.rencana_riil > 0 ? it.rencana_riil : it.nominal) : it.nominal;
        let buktiUrl = String(it.nota_url || '').trim();
        if (!buktiUrl && pakaiKuitansi(it)) {
          try { buktiUrl = buatKuitansi(it, tglTx, nb, riil, me); }
          catch (e) { logError(e); return { ok: false, error: 'Gagal membuat kuitansi otomatis: ' + pesanGangguan(e.message) + ' — coba lagi.' }; }
        }
        const txId = idUnik('TX');
        txByItem[it.id] = txId;
        txRows.push([txId, it.dapur, tglTx, teksSel(nb), it.jenis, it.kategori, it.uraian,
          'VA', riil, it.nominal, buktiUrl, now, me.id, it.periode_id, it.id]);
        const fee = it.biaya_admin > 0 ? it.biaya_admin : 0;
        if (fee > 0) {
          const fRow = feeRowFor(it, txId, tglTx, nb, buktiUrl, fee, me.id);
          fRow[3] = teksSel(fRow[3]); fRow[11] = now;
          txRows.push(fRow);
        }
      }
      if (txRows.length) txSh.getRange(txSh.getLastRow() + 1, 1, txRows.length, 15).setValues(txRows);
    }

    const sh = getSheet(SHEETS.PITEM);
    pending.forEach(function(it) {
      const d = map[it.id];
      // catatan akuntan & ACC backdate admin tetap disimpan; catatan penyetuju (setuju/revisi/tolak) ditaruh di depan
      const lama = String(it.catatan || ''), catatanLama = (lama.indexOf(AWALAN_CATATAN_AKUNTAN) === 0 || /^ACC backdate Admin/i.test(lama)) ? lama : '';
      const baruRaw = String(d.catatan || '').trim();
      const baru = baruRaw && d.status === 'DISETUJUI' && !/^Catatan persetujuan:/i.test(baruRaw) ? 'Catatan persetujuan: ' + baruRaw : baruRaw;
      const statusAkhir = d.status === 'DISETUJUI' ? 'TEREALISASI' : d.status;
      sh.getRange(it._row, 15, 1, 2).setValues([[statusAkhir, baru && catatanLama ? baru + ' | ' + catatanLama : (baru || catatanLama)]]);
      sh.getRange(it._row, 18, 1, 2).setValues([[now, me.id]]);
      if (txByItem[it.id]) sh.getRange(it._row, 20).setValue(txByItem[it.id]);
      sh.getRange(it._row, 22).setValue(now);
    });
    const hs = getSheet(SHEETS.PENGAJUAN);
    hs.getRange(head._row, 9, 1, 2).setValues([[now, me.id]]);
    refreshHeaderStatus(head.id);
    logActivity(me.id, 'decidePengajuan', head.nomor + ' (setuju & terealisasi ' + rupiah(totalSetuju) + ')');
    return { ok: true, data: { totalSetuju: totalSetuju, terealisasi: disetujuiList.length } };
  });
}

// ACC / Tolak pengajuan backdate oleh Admin sebelum diteruskan ke persetujuan PIC/Yayasan
function decideBackdatePengajuan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'admin') return { ok: false, error: 'Hanya Admin yang dapat menyetujui/menolak pengajuan backdate' };
  const rawSt = String(p.status || '').toUpperCase();
  const st = rawSt === 'ACC' ? 'DISETUJUI' : rawSt;
  if (st !== 'DISETUJUI' && st !== 'DITOLAK') return { ok: false, error: 'Status keputusan tidak valid' };
  const catatan = String(p.catatan || '').replace(/\s+/g, ' ').trim().substring(0, 400);
  if (st === 'DITOLAK' && !catatan) return { ok: false, error: 'Alasan penolakan backdate wajib diisi' };

  return withLock(function() {
    const head = readAllPengajuan().find(h => h.id === p.pengajuan_id);
    if (!head) return { ok: false, error: 'Pengajuan tidak ditemukan' };
    const pending = readAllItems().filter(i => i.pengajuan_id === head.id && i.status === 'MENUNGGU_ADMIN');
    if (!pending.length) return { ok: false, error: 'Tidak ada baris backdate yang menunggu ACC Admin' };
    const periodeHead = readAllPeriode(head.dapur).find(r => r.id === head.periode_id);
    const periodeTutup = !periodeHead || periodeHead.status !== 'AKTIF';
    if (periodeTutup && st !== 'DITOLAK') {
      return { ok: false, error: 'Periode pengajuan ini sudah ditutup — pengajuan backdate yang tertinggal hanya bisa ditolak' };
    }
    const now = new Date();
    const sh = getSheet(SHEETS.PITEM);
    if (st === 'DISETUJUI') {
      const infoAcc = 'ACC backdate Admin (' + (me.nama || me.id) + ')' + (catatan ? ': ' + catatan : '');
      pending.forEach(function(it) {
        const lama = String(it.catatan || '').trim();
        const catBaru = lama ? lama + ' | ' + infoAcc : infoAcc;
        sh.getRange(it._row, 15, 1, 2).setValues([['DIAJUKAN', catBaru]]);
        sh.getRange(it._row, 22).setValue(now);
      });
      refreshHeaderStatus(head.id);
      logActivity(me.id, 'accBackdatePengajuan', head.nomor + ' (' + pending.length + ' baris diteruskan ke PIC/Yayasan)');
      return { ok: true, data: { status: 'DIAJUKAN', jumlah: pending.length } };
    } else {
      const infoTolak = 'Backdate ditolak Admin (' + (me.nama || me.id) + '): ' + catatan;
      pending.forEach(function(it) {
        const lama = String(it.catatan || '').trim();
        const catBaru = lama ? infoTolak + ' | ' + lama : infoTolak;
        sh.getRange(it._row, 15, 1, 2).setValues([['DITOLAK', catBaru]]);
        sh.getRange(it._row, 18, 1, 2).setValues([[now, me.id]]);
        sh.getRange(it._row, 22).setValue(now);
      });
      getSheet(SHEETS.PENGAJUAN).getRange(head._row, 9, 1, 2).setValues([[now, me.id]]);
      refreshHeaderStatus(head.id);
      logActivity(me.id, 'tolakBackdatePengajuan', head.nomor + ' (' + pending.length + ' baris ditolak)');
      return { ok: true, data: { status: 'DITOLAK', jumlah: pending.length } };
    }
  });
}

// ============================================================
//  v6 — REALISASI (item disetujui → transaksi + bukti)
// ============================================================

function getRealisasiList(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  const heads = {};
  readAllPengajuan().forEach(h => { heads[h.id] = h; });
  const rows = readAllItems().filter(i => i.dapur === me.dapur && i.status === 'DISETUJUI')
    .map(i => Object.assign({}, i, { nomor: heads[i.pengajuan_id] ? heads[i.pengajuan_id].nomor : '',
      tanggal_pengajuan: heads[i.pengajuan_id] ? heads[i.pengajuan_id].tanggal : '' }));
  rows.sort((a, b) => (a.pengajuan_id === b.pengajuan_id ? a.urut - b.urut : (a.pengajuan_id < b.pengajuan_id ? -1 : 1)));
  return { ok: true, data: rows };
}

function realisasiItem(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  if (!p.item_id || !p.tanggal) return { ok: false, error: 'Tanggal realisasi wajib' };

  return withLock(function() {
    const it = findItem(p.item_id);
    if (!it) return { ok: false, error: 'Baris pengajuan tidak ditemukan' };
    if (it.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
    if (it.status !== 'DISETUJUI') return { ok: false, error: 'Baris berstatus ' + it.status + ', tidak bisa direalisasikan' };
    // realisasi hanya pada tanggal pengajuan (tidak ada realisasi di luar tanggal pengajuan)
    const head = readAllPengajuan().find(function(h) { return h.id === it.pengajuan_id; });
    if (head && /^\d{4}-\d{2}-\d{2}$/.test(head.tanggal) && String(p.tanggal).substring(0, 10) !== head.tanggal)
      return { ok: false, error: 'Tanggal realisasi harus sama dengan tanggal pengajuan (' + head.tanggal.split('-').reverse().join('-') + ')' };
    const periode = findPeriodeCoveringDate(me.dapur, p.tanggal);
    if (!periode || periode.id !== it.periode_id) return { ok: false, error: 'Tanggal realisasi harus di dalam periode pengajuan' };

    // Bukti: unggahan akuntan; bila kosong → nota pengajuan atau kuitansi otomatis (kategori tertentu)
    let buktiUrl = String(p.bukti_url || '').trim();
    const sumberBukti = buktiUrl ? 'unggah' : it.nota_url ? 'nota' : pakaiKuitansi(it) ? 'kuitansi' : '';
    if (!sumberBukti) return { ok: false, error: 'Bukti transfer / nota wajib diunggah untuk ' + it.jenis + ' · ' + it.kategori };
    if (sumberBukti === 'nota') buktiUrl = it.nota_url;
    let katTx = it.kategori;
    if (it.kategori === 'Barang Habis Pakai' && p.sub_kategori) {
      if (SUB_BHP.indexOf(p.sub_kategori) < 0) return { ok: false, error: 'Sub-kategori harus ' + SUB_BHP.join(' / ') };
      katTx = p.sub_kategori;
    }
    const riil = butuhRencanaRealisasi(it.jenis, it.kategori) ? Number(p.riil || it.rencana_riil) : it.nominal;
    if (!(riil > 0)) return { ok: false, error: 'Realisasi aktual wajib diisi' };
    const fee = parseFee(p.biaya_admin !== undefined ? p.biaya_admin : it.biaya_admin);
    if (fee < 0) return { ok: false, error: 'Biaya admin harus antara Rp 1 dan ' + rupiah(BIAYA_ADMIN_MAX) };

    if (!String(p.no_bukti || '').trim() && it.nota_no) p.no_bukti = it.nota_no;   // nomor nota dari pengajuan
    const nb = siapkanNoBukti(p.no_bukti, it.dapur, p.tanggal, null);
    if (nb.error) return { ok: false, error: nb.error + (it.nota_no && p.no_bukti === it.nota_no ? ' Ubah nomor nota di baris pengajuan.' : '') };
    p.no_bukti = nb.value;
    const txId = idUnik('TX');
    if (sumberBukti === 'kuitansi') {
      try { buktiUrl = buatKuitansi(it, p.tanggal, p.no_bukti, riil, me); }
      catch (e) { logError(e); return { ok: false, error: 'Gagal membuat kuitansi otomatis: ' + pesanGangguan(e.message) + ' — coba lagi atau unggah bukti manual.' }; }
    }
    getSheet(SHEETS.TRANSAKSI).appendRow([
      txId, it.dapur, p.tanggal, teksSel(p.no_bukti), it.jenis, katTx, it.uraian,
      'VA', riil, it.nominal, buktiUrl, new Date(), me.id, it.periode_id, it.id
    ]);
    if (fee > 0) getSheet(SHEETS.TRANSAKSI).appendRow(feeRowFor(it, txId, p.tanggal, p.no_bukti, buktiUrl, fee, me.id));
    const sh = getSheet(SHEETS.PITEM);
    sh.getRange(it._row, 15).setValue('TEREALISASI');
    sh.getRange(it._row, 20).setValue(txId);
    sh.getRange(it._row, 22).setValue(new Date());
    logActivity(me.id, 'realisasiItem', it.id + ' → ' + txId + (fee > 0 ? ' + biaya admin ' + fee : ''));
    return { ok: true, data: { transaksi_id: txId, no_bukti: p.no_bukti, bukti: sumberBukti, bukti_url: buktiUrl } };
  });
}

// ── Kuitansi / bukti pembayaran otomatis (PDF di folder bukti) untuk pembayaran tanpa nota toko ──
const KATEGORI_KUITANSI = ['Insentif Guru/PIC Sekolah', 'Insentif Kader Posyandu', 'Sewa Kendaraan'];
function pakaiKuitansi(it) { return it.jenis === 'Fasilitas SPPG' || (it.jenis === 'Operasional' && KATEGORI_KUITANSI.indexOf(it.kategori) >= 0); }
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function t(x) {
    if (x < 12) return s[x];
    if (x < 20) return t(x - 10) + ' belas';
    if (x < 100) return t(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + t(x % 10) : '');
    if (x < 200) return 'seratus' + (x > 100 ? ' ' + t(x - 100) : '');
    if (x < 1000) return t(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + t(x % 100) : '');
    if (x < 2000) return 'seribu' + (x > 1000 ? ' ' + t(x - 1000) : '');
    if (x < 1e6) return t(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + t(x % 1000) : '');
    if (x < 1e9) return t(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + t(x % 1e6) : '');
    if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + t(x % 1e9) : '');
    return t(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + t(x % 1e12) : '');
  }
  const h = n === 0 ? 'nol' : t(n);
  return (h.charAt(0).toUpperCase() + h.slice(1) + ' rupiah').replace(/\s+/g, ' ');
}
function escHtml(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function imgTtd(u) { return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(String(u || '')) ? '<img src="' + u + '" style="max-height:64px;max-width:200px"/>' : ''; }
// Pengawas Keuangan = akuntan aktif dapur (TTD dari Profil akuntan); pemilik gedung (insentif Fasilitas SPPG) = PIC dapur (TTD dari Profil PIC)
function userAktifDapur(dapurId, role) {
  const u = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1).find(function(x) { return String(x[4]).toLowerCase() === role && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; });
  return u ? { id: u[0], nama: String(u[3] || '') } : null;
}
function htmlKuitansi(d) {
  const baris = function(k, v) { return '<tr><td style="width:34%;padding:4px 0;vertical-align:top">' + k + '</td><td style="padding:4px 0">: ' + v + '</td></tr>'; };
  return '<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:12px;color:#111;margin:28px">' +
    '<div style="text-align:center;font-weight:bold;font-size:14px">' + escHtml(d.dapur) + '</div>' +
    (d.alamat ? '<div style="text-align:center;font-size:11px">' + escHtml(d.alamat) + '</div>' : '') +
    '<hr style="margin:10px 0 14px"/><div style="text-align:center;font-weight:bold;font-size:16px;letter-spacing:1px">KUITANSI / BUKTI PEMBAYARAN</div>' +
    '<div style="text-align:center;margin-bottom:16px">Nomor: ' + escHtml(d.nomor) + '</div><table style="width:100%;border-collapse:collapse">' +
    baris('Telah terima dari', escHtml(d.dapur)) + baris('Uang sejumlah', '<b>' + escHtml(d.rupiah) + '</b>') + baris('Terbilang', '<i>' + escHtml(d.terbilang) + '</i>') +
    baris('Untuk pembayaran', escHtml(d.untuk)) + baris('Dibayarkan kepada', escHtml(d.penerima)) + baris('Rekening tujuan', escHtml(d.rekening)) +
    baris('Tanggal pembayaran', escHtml(d.tanggal)) + baris('Referensi', escHtml(d.ref)) + '</table>' +
    '<table style="width:100%;margin-top:36px;text-align:center"><tr><td style="width:50%">Yang menyerahkan,<br/>Pengawas Keuangan</td><td>Yang menerima,</td></tr>' +
    '<tr><td style="height:70px">' + imgTtd(d.ttdPenyerah) + '</td><td>' + imgTtd(d.ttdPenerima) + '</td></tr><tr><td>( ' + escHtml(d.penyerah || '................................') + ' )</td><td>( ' + escHtml(d.penerima) + ' )</td></tr></table>' +
    '<div style="margin-top:24px;font-size:10px;color:#555">Dibuat otomatis oleh aplikasi Keuangan MBG saat persetujuan/realisasi. Sah sebagai bukti autentik setelah ditandatangani kedua pihak.</div></body></html>';
}
function buatKuitansi(it, tanggal, noBukti, nominal, me) {
  const dapur = getDapur().data.find(function(x) { return x.id === it.dapur; }) || {};
  const ident = readIdentitasLPDH(it.dapur) || {};
  const head = readAllPengajuan().find(function(h) { return h.id === it.pengajuan_id; }) || {};
  const akn = userAktifDapur(it.dapur, 'akuntan'), pic = it.jenis === 'Fasilitas SPPG' ? userAktifDapur(it.dapur, 'pic') : null;
  const html = htmlKuitansi({ dapur: dapur.nama || it.dapur, alamat: dapur.alamat || '', nomor: noBukti, rupiah: rupiah(nominal), terbilang: terbilang(nominal),
    untuk: it.kategori + ' — ' + it.uraian, penerima: it.penerima_nama, rekening: it.bank + ' ' + it.no_rek, tanggal: tanggal,
    ref: (head.nomor || '') + ' #' + it.urut, penyerah: ident.pengawas_nama || (akn && akn.nama) || me.nama || '',
    ttdPenyerah: akn ? readTtdDataUrl(akn.id) : null, ttdPenerima: pic ? readTtdDataUrl(pic.id) : null });
  const nama = 'KUITANSI_' + tanggal + '_' + String(noBukti).replace(/[^a-zA-Z0-9_-]+/g, '-');
  const pdf = Utilities.newBlob(html, 'text/html', nama + '.html').getAs('application/pdf').setName(nama + '.pdf');
  const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(pdf);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// Dipanggil saat transaksi hasil persetujuan/realisasi dihapus → item dibatalkan (tidak kembali ke antrean realisasi)
function revertItemRealisasi(itemId) {
  try {
    const it = findItem(itemId);
    if (!it || it.status !== 'TEREALISASI') return;
    const sh = getSheet(SHEETS.PITEM);
    const cat = 'Transaksi dihapus' + (it.catatan ? ' | ' + it.catatan : '');
    sh.getRange(it._row, 15, 1, 2).setValues([['DIBATALKAN', cat]]);
    sh.getRange(it._row, 20).setValue('');
    sh.getRange(it._row, 22).setValue(new Date());
    refreshHeaderStatus(it.pengajuan_id);
  } catch (e) { logError(e); }
}

// ============================================================
//  v6 — PERUBAHAN TRANSAKSI PERIODE LALU (diajukan akuntan, disetujui admin)
//  PerubahanTx: id | transaksi_id | dapur_id | periode_id | aksi | data_lama | data_baru | alasan
//             | status | requested_at | requested_by | decided_at | decided_by | catatan
//  Periode AKTIF tetap diedit langsung oleh akuntan (updateTransaksi/deleteTransaksi).
// ============================================================

const TX_COL = { tanggal: 3, no_bukti: 4, jenis: 5, kategori: 6, uraian: 7, sumber: 8, riil: 9, unriil: 10, bukti_url: 11 };
const TX_FIELDS_ALL = ['tanggal', 'no_bukti', 'jenis', 'kategori', 'uraian', 'sumber', 'riil', 'unriil', 'bukti_url'];

function txSnapshot(t) {
  return { tanggal: t.tanggal, no_bukti: String(t.no_bukti || ''), jenis: t.jenis, kategori: t.kategori, uraian: t.uraian,
    sumber: t.sumber, riil: t.riil, unriil: t.unriil, bukti_url: t.bukti_url || '' };
}
function findTx(id) { return readAllTransaksi(null).find(t => t.id === id); }
function isLinked(t) { const l = String(t.pengajuan_item_id || ''); return !!l && l.indexOf('DARURAT') !== 0; }
// Biaya admin transfer: transaksi terpisah yang menempel ke baris realisasi (link 'ADMIN:{item_id}')
const BIAYA_ADMIN_PREFIX = 'ADMIN:';
const BIAYA_ADMIN_MAX = 50000;
function isFeeLink(l) { return String(l || '').indexOf(BIAYA_ADMIN_PREFIX) === 0; }
function feeRowFor(it, txIdUtama, tanggal, noBukti, buktiUrl, fee, userId) {
  return [txIdUtama + '-ADM', it.dapur, tanggal, String(noBukti) + '-ADM', 'Operasional', 'Biaya Admin Bank',
    'Biaya admin transfer: ' + it.uraian + ' \u2192 ' + it.penerima_nama + ' (' + it.bank + ')',
    'VA', fee, fee, buktiUrl, new Date(), userId, it.periode_id, BIAYA_ADMIN_PREFIX + it.id];
}
// Hapus transaksi biaya admin milik satu baris pengajuan (dipanggil saat transaksi utamanya dihapus)
function deleteFeeTx(itemId) {
  const sheet = getSheet(SHEETS.TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][14] || '') === BIAYA_ADMIN_PREFIX + itemId) sheet.deleteRow(i + 1);
  }
}
// Biaya admin transfer: sesama bank VA dapur = gratis; antarbank = Rp 6.500 (online). Rekomendasi per dapur menurut bank VA di Identitas LPDH.
const BIAYA_TRANSFER_ANTARBANK = 6500;
function kodeBank(b) {
  const s = String(b || '').toUpperCase();
  if (/\bBSI\b|SYARIAH INDONESIA/.test(s)) return 'BSI';
  if (/\bBRI\b|RAKYAT INDONESIA/.test(s)) return 'BRI';
  if (/\bBNI\b|NEGARA INDONESIA/.test(s)) return 'BNI';
  if (/MANDIRI/.test(s)) return 'MANDIRI';
  if (/\bBCA\b|CENTRAL ASIA/.test(s)) return 'BCA';
  if (/\bBTN\b|TABUNGAN NEGARA/.test(s)) return 'BTN';
  return s.trim();
}
function feeTransfer(bankPenerima, bankVA) { const a = kodeBank(bankPenerima), b = kodeBank(bankVA); if (!b) return 0; return a && a === b ? 0 : BIAYA_TRANSFER_ANTARBANK; }   // bank VA belum diisi → tidak ditebak
function getBankVA(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = me.dapur || String(p.dapur || '');
  if (!dapurId) return { ok: true, data: { bank: '', fee: BIAYA_TRANSFER_ANTARBANK } };
  return { ok: true, data: { bank: String((readIdentitasLPDH(dapurId) || {}).bank || ''), fee: BIAYA_TRANSFER_ANTARBANK } };
}
function parseFee(v) {
  if (v === undefined || v === null || v === '' || v === false || v === 'false' || Number(v) === 0) return 0;
  const n = Math.round(Number(v));
  if (!(n > 0) || n > BIAYA_ADMIN_MAX) return -1;
  return n;
}
// Tambah biaya admin pada realisasi yang sudah tersimpan (lupa dicentang)
function addBiayaAdmin(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  const fee = parseFee(p.nominal);
  if (fee <= 0) return { ok: false, error: 'Biaya admin harus antara Rp 1 dan ' + rupiah(BIAYA_ADMIN_MAX) };
  return withLock(function() {
    const tx = findTx(p.transaksi_id);
    if (!tx) return { ok: false, error: 'Transaksi tidak ditemukan' };
    if (tx.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
    if (!isLinked(tx) || isFeeLink(tx.pengajuan_item_id)) return { ok: false, error: 'Biaya admin hanya untuk transaksi hasil realisasi pengajuan' };
    const per = readAllPeriode(tx.dapur).find(r => r.id === tx.periode_id);
    if (!per || per.status !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup' };
    if (readAllTransaksi([tx.dapur], tx.periode_id).some(t => t.pengajuan_item_id === BIAYA_ADMIN_PREFIX + tx.pengajuan_item_id)) return { ok: false, error: 'Biaya admin untuk transaksi ini sudah ada' };
    const it = findItem(tx.pengajuan_item_id);
    if (!it) return { ok: false, error: 'Baris pengajuan tidak ditemukan' };
    getSheet(SHEETS.TRANSAKSI).appendRow(feeRowFor(it, tx.id, tx.tanggal, tx.no_bukti, tx.bukti_url, fee, me.id));
    logActivity(me.id, 'addBiayaAdmin', tx.id + ' ' + fee);
    return { ok: true };
  });
}

function readAllPerubahan() {
  const data = getSheet(SHEETS.PERUBAHAN).getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    let lama = {}, baru = {};
    try { lama = JSON.parse(r[5] || '{}'); } catch (e) {}
    try { baru = JSON.parse(r[6] || '{}'); } catch (e) {}
    rows.push({ _row: i + 1, seq: i, id: r[0], transaksi_id: r[1], dapur: r[2], periode_id: r[3], aksi: r[4],
      data_lama: lama, data_baru: baru, alasan: r[7] || '', status: r[8], requested_at: formatTimestamp(r[9]),
      requested_by: r[10], decided_at: formatTimestamp(r[11]), decided_by: r[12] || '', catatan: r[13] || '' });
  }
  return rows;
}

function requestTxChange(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan') return { ok: false, error: 'Hanya akuntan' };
  const aksi = String(p.aksi || '').toUpperCase();
  if (aksi !== 'EDIT' && aksi !== 'HAPUS') return { ok: false, error: 'Aksi tidak valid' };
  if (!String(p.alasan || '').trim()) return { ok: false, error: 'Alasan perubahan wajib diisi' };

  return withLock(function() {
    const tx = findTx(p.transaksi_id);
    if (!tx) return { ok: false, error: 'Transaksi tidak ditemukan' };
    if (tx.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
    const per = readAllPeriode(tx.dapur).find(r => r.id === tx.periode_id);
    if (!per) return { ok: false, error: 'Periode transaksi tidak ditemukan' };
    if (per.status === 'AKTIF') return { ok: false, error: 'Periode masih aktif — edit langsung dari Riwayat tanpa persetujuan' };
    if (readAllPerubahan().some(r => r.transaksi_id === tx.id && r.status === 'MENUNGGU')) {
      return { ok: false, error: 'Transaksi ini sudah punya pengajuan perubahan yang menunggu admin' };
    }

    const lama = txSnapshot(tx);
    let baru = {};
    if (aksi === 'EDIT') {
      const linked = isLinked(tx);
      const allowed = linked ? (tx.jenis === 'Operasional' ? ['tanggal', 'no_bukti', 'bukti_url', 'riil'].concat(lama.kategori === 'Barang Habis Pakai' ? ['kategori'] : []) : ['tanggal', 'no_bukti', 'bukti_url'])
                             : TX_FIELDS_ALL;
      allowed.forEach(function(k) {
        if (p[k] === undefined || p[k] === null || p[k] === '') return;
        let v = (k === 'riil' || k === 'unriil') ? Number(p[k]) : String(p[k]).trim();
        if (v !== lama[k]) baru[k] = v;
      });
      if (!Object.keys(baru).length) return { ok: false, error: 'Tidak ada perubahan' };
      const merged = Object.assign({}, lama, baru);
      if (baru.no_bukti !== undefined && !nbBerubah(baru.no_bukti, tx._rowIndex)) delete baru.no_bukti;
      if (!Object.keys(baru).length) return { ok: false, error: 'Tidak ada perubahan' };
      if (baru.no_bukti !== undefined) { const nb = siapkanNoBukti(baru.no_bukti, tx.dapur, merged.tanggal, tx.id); if (nb.error) return { ok: false, error: nb.error }; }
      if (merged.tanggal < per.tanggal_mulai || merged.tanggal > per.tanggal_akhir) return { ok: false, error: 'Tanggal harus di dalam Periode ' + per.periode_no };
      if (!kategoriSah(merged.jenis, merged.kategori, lama.kategori)) return { ok: false, error: 'Jenis/kategori tidak valid' };
      if (linked && baru.kategori !== undefined && SUB_BHP.indexOf(baru.kategori) < 0) return { ok: false, error: 'Sub-kategori harus ' + SUB_BHP.join(' / ') };
      if (!(merged.riil > 0) || !(merged.unriil > 0)) return { ok: false, error: 'Nominal harus lebih dari 0' };
      if (!linked && merged.jenis === 'Bahan Baku' && merged.unriil !== merged.riil) { baru.unriil = merged.riil; }
      if (isFeeLink(tx.pengajuan_item_id) && baru.riil !== undefined) {
        if (baru.riil > BIAYA_ADMIN_MAX) return { ok: false, error: 'Biaya admin maksimal ' + rupiah(BIAYA_ADMIN_MAX) };
        baru.unriil = baru.riil;
      }
    }

    const id = idUnik('CH');
    getSheet(SHEETS.PERUBAHAN).appendRow([id, tx.id, tx.dapur, tx.periode_id, aksi, JSON.stringify(lama), JSON.stringify(baru),
      String(p.alasan).trim(), 'MENUNGGU', new Date(), me.id, '', '', '']);
    logActivity(me.id, 'requestTxChange', id + ' ' + aksi + ' ' + tx.id);
    return { ok: true, data: { id: id } };
  });
}

function getTxChanges(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'admin' && me.role !== 'akuntan') return { ok: false, error: 'Tidak berwenang' };
  let rows = readAllPerubahan();
  if (me.role === 'akuntan') rows = rows.filter(r => r.dapur === me.dapur);
  if (p.filter === 'menunggu') rows = rows.filter(r => r.status === 'MENUNGGU');
  if (p.periode_id) rows = rows.filter(r => r.periode_id === p.periode_id);
  const names = {};
  getSheet(SHEETS.USERS).getDataRange().getValues().slice(1).forEach(u => { names[u[0]] = u[3]; });
  const periodes = {};
  readAllPeriode(null).forEach(r => { periodes[r.id] = r; });
  rows = rows.map(r => Object.assign({}, r, {
    requested_by_nama: names[r.requested_by] || r.requested_by, decided_by_nama: names[r.decided_by] || r.decided_by,
    periode_no: periodes[r.periode_id] ? periodes[r.periode_id].periode_no : '',
    periode_status: periodes[r.periode_id] ? periodes[r.periode_id].status : 'DIHAPUS',
  }));
  rows.sort((a, b) => b.seq - a.seq);
  return { ok: true, data: rows };
}

function decideTxChange(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'admin') return { ok: false, error: 'Hanya admin' };
  const status = String(p.status || '').toUpperCase();
  if (status !== 'DISETUJUI' && status !== 'DITOLAK') return { ok: false, error: 'Keputusan tidak valid' };
  if (status === 'DITOLAK' && !String(p.catatan || '').trim()) return { ok: false, error: 'Alasan penolakan wajib diisi' };

  return withLock(function() {
    const req = readAllPerubahan().find(r => r.id === p.id);
    if (!req) return { ok: false, error: 'Pengajuan perubahan tidak ditemukan' };
    if (req.status !== 'MENUNGGU') return { ok: false, error: 'Sudah diputuskan sebelumnya' };
    const sh = getSheet(SHEETS.PERUBAHAN);

    if (status === 'DISETUJUI') {
      const tx = findTx(req.transaksi_id);
      if (!tx) return { ok: false, error: 'Transaksi sudah tidak ada. Tolak pengajuan ini.' };
      const now = txSnapshot(tx);
      const berubah = Object.keys(req.data_lama).filter(k => String(req.data_lama[k]) !== String(now[k]));
      if (berubah.length) return { ok: false, error: 'Transaksi sudah berubah sejak diajukan (' + berubah.join(', ') + '). Tolak dan minta akuntan mengajukan ulang.' };
      const txSheet = getSheet(SHEETS.TRANSAKSI);
      if (req.aksi === 'EDIT') {
        if (req.data_baru.no_bukti !== undefined) {
          const nb = siapkanNoBukti(req.data_baru.no_bukti, tx.dapur, req.data_baru.tanggal || tx.tanggal, tx.id);
          if (nb.error) return { ok: false, error: nb.error + ' Tolak pengajuan ini dan minta akuntan mengajukan ulang.' };
        }
        Object.keys(req.data_baru).forEach(function(k) {
          if (TX_COL[k]) txSheet.getRange(tx._rowIndex, TX_COL[k]).setValue(k === 'no_bukti' ? teksSel(req.data_baru[k]) : req.data_baru[k]);
        });
      } else {
        txSheet.deleteRow(tx._rowIndex);
        if (isLinked(tx) && !isFeeLink(tx.pengajuan_item_id)) {
          deleteFeeTx(tx.pengajuan_item_id);
          const it = findItem(tx.pengajuan_item_id);
          if (it) {
            const ish = getSheet(SHEETS.PITEM);
            ish.getRange(it._row, 15, 1, 2).setValues([['DIBATALKAN', 'Transaksi dihapus lewat perubahan periode lalu (' + req.id + ')']]);
            ish.getRange(it._row, 20).setValue('');
            ish.getRange(it._row, 22).setValue(new Date());
          }
        }
      }
    }
    sh.getRange(req._row, 9).setValue(status);
    sh.getRange(req._row, 12, 1, 3).setValues([[new Date(), me.id, String(p.catatan || '').trim()]]);
    logActivity(me.id, 'decideTxChange', req.id + ' ' + status);
    return { ok: true, data: { status: status,
      peringatan: status === 'DISETUJUI' ? 'Saldo akhir periode ini berubah. Periksa apakah saldo awal periode berikutnya perlu dikoreksi di Setup.' : '' } };
  });
}

// ============================================================
//  MIGRASI V6 — jalankan SEKALI setelah paste kode ini
//  Aman dijalankan ulang: hanya menambah sheet/kolom yang belum ada.
// ============================================================

function migrateV6() {
  const ss = getSS();
  function ensureHeaders(name, headers) {
    let s = ss.getSheetByName(name);
    if (!s) { s = ss.insertSheet(name); }
    const lastCol = Math.max(s.getLastColumn(), 1);
    const cur = s.getRange(1, 1, 1, lastCol).getValues()[0];
    headers.forEach(function(h, idx) {
      if (!cur[idx]) s.getRange(1, idx + 1).setValue(h);
    });
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#15663E').setFontColor('#ffffff');
    s.setFrozenRows(1);
    return s;
  }
  ensureHeaders(SHEETS.SESI, ['token', 'user_id', 'created_at']);
  ensureHeaders(SHEETS.PERUBAHAN, ['id', 'transaksi_id', 'dapur_id', 'periode_id', 'aksi', 'data_lama', 'data_baru', 'alasan',
    'status', 'requested_at', 'requested_by', 'decided_at', 'decided_by', 'catatan']);
  ensureHeaders(SHEETS.PENERIMA, ['id', 'nama', 'bank', 'no_rek', 'aktif', 'created_at', 'created_by', 'updated_at', 'updated_by']);
  ensureHeaders(SHEETS.PENGAJUAN, ['id', 'nomor', 'dapur_id', 'periode_id', 'tanggal', 'status', 'created_at', 'created_by', 'decided_at', 'decided_by']);
  ensureHeaders(SHEETS.PITEM, ['id', 'pengajuan_id', 'dapur_id', 'periode_id', 'urut', 'jenis', 'kategori', 'uraian', 'nominal',
    'penerima_id', 'penerima_nama', 'bank', 'no_rek', 'susulan', 'status', 'catatan', 'putaran',
    'decided_at', 'decided_by', 'transaksi_id', 'created_at', 'updated_at',
    'rincian_bahan', 'nota_url', 'nota_no', 'rencana_riil', 'biaya_admin']);
  ensureHeaders(SHEETS.TRANSAKSI, ['id','dapur_id','tanggal','no_bukti','jenis','kategori','uraian','sumber','riil','unriil','bukti_url','created_at','created_by','periode_id','pengajuan_item_id']);

  const d = ensureHeaders(SHEETS.DAPUR, ['id', 'nama', 'alamat', 'kode', 'telepon', 'email']);
  const kodeMap = { 'D001': 'CPJ02', 'D002': 'MKS01', 'D003': 'SKM01', 'D004': 'CPK02' };
  const dd = d.getDataRange().getValues();
  for (let i = 1; i < dd.length; i++) {
    if (!dd[i][3] && kodeMap[dd[i][0]]) d.getRange(i + 1, 4).setValue(kodeMap[dd[i][0]]);
  }
  try { SpreadsheetApp.getActive().toast('Migrasi v6 selesai.', 'Migrasi v6', 8); } catch (e) {}
  Logger.log('Migrasi v6 selesai');
}

// ============================================================
//  HELPERS
// ============================================================

// Buka spreadsheet SEKALI per permintaan (dulu dibuka ulang di tiap getSheet) dan coba ulang
// bila Google gagal sesaat ("Anda tidak memiliki izin…" / "Layanan Spreadsheet gagal…").
let _SS = null;
let _reqVals = {};
let _reqSheets = {};
function resetReqCache() { _reqVals = {}; _reqSheets = {}; }

// Cache nilai sheet lintas-permintaan di CacheService (90 detik, otomatis dihapus instan saat ada penulisan ke sheet tsb).
// Di lingkungan Apps Script asli (typeof __book === 'undefined'), permintaan baca yang ter-cache tidak perlu membuka SpreadsheetApp sama sekali.
function useSrvSheetCache() { return typeof __book === 'undefined' || (typeof __srvCache !== 'undefined' && __srvCache); }
const SRV_SHEET_TTL = 90;
function srvSheetGet(name) {
  if (!useSrvSheetCache() || name === SHEETS.SESI || name === SHEETS.LOG) return null;
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('shv_' + name);
    if (!raw) return null;
    if (raw.indexOf('#CH:') === 0) {
      const n = Number(raw.substring(4)) || 0;
      if (n <= 0 || n > 6) return null;
      const keys = []; for (let i = 0; i < n; i++) keys.push('shv_' + name + '_' + i);
      const hit = ttdCacheGetAll(cache, keys);
      const parts = [];
      for (let i = 0; i < n; i++) { if (!hit[keys[i]]) return null; parts.push(hit[keys[i]]); }
      return JSON.parse(parts.join(''));
    }
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function srvSheetPut(name, vals) {
  if (!useSrvSheetCache() || name === SHEETS.SESI || name === SHEETS.LOG) return;
  try {
    const norm = vals.map(function(row) {
      return row.map(function(v) { return v instanceof Date ? formatTimestamp(v) : v; });
    });
    const s = JSON.stringify(norm);
    if (s.length > 90000 * 6) return;
    const cache = CacheService.getScriptCache();
    if (s.length <= 90000) { cache.put('shv_' + name, s, SRV_SHEET_TTL); return; }
    const n = Math.ceil(s.length / 90000), map = {};
    map['shv_' + name] = '#CH:' + n;
    for (let i = 0; i < n; i++) map['shv_' + name + '_' + i] = s.substring(i * 90000, (i + 1) * 90000);
    ttdCachePutAll(cache, map);
  } catch (e) {}
}
function srvSheetDel(name) {
  if (!useSrvSheetCache()) return;
  try { CacheService.getScriptCache().remove('shv_' + name); } catch (e) {}
}

function wrapSheet(name, shOrFn) {
  if (!shOrFn) return shOrFn;
  if (name === SHEETS.SESI) return typeof shOrFn === 'function' ? shOrFn() : shOrFn;
  if (_reqSheets[name]) return _reqSheets[name];
  let _raw = typeof shOrFn === 'function' ? null : shOrFn;
  function raw() { if (!_raw) _raw = shOrFn(); return _raw; }
  const inv = function() { delete _reqVals[name]; srvSheetDel(name); };
  const w = {
    getDataRange: function() {
      return {
        getValues: function() {
          if (!_reqVals[name]) {
            const cached = srvSheetGet(name);
            if (cached) _reqVals[name] = cached;
            else {
              _reqVals[name] = raw().getDataRange().getValues();
              srvSheetPut(name, _reqVals[name]);
            }
          }
          return _reqVals[name].map(function(r) { return r.slice(); });
        }
      };
    },
    getRange: function(r, c, nr, nc) {
      const sh = raw();
      const rng = arguments.length === 2 ? sh.getRange(r, c) : arguments.length === 3 ? sh.getRange(r, c, nr) : sh.getRange(r, c, nr, nc);
      return {
        getValues: function() { return rng.getValues(); },
        getDisplayValues: function() { return rng.getDisplayValues(); },
        setValue: function(v) { inv(); return rng.setValue(v); },
        setValues: function(v) { inv(); return rng.setValues(v); },
        setFontWeight: function(v) { return rng.setFontWeight(v); },
      };
    },
    appendRow: function(row) { inv(); return raw().appendRow(row); },
    deleteRow: function(n) { inv(); return raw().deleteRow(n); },
    getLastRow: function() { return _reqVals[name] ? _reqVals[name].length : raw().getLastRow(); },
    getLastColumn: function() { return raw().getLastColumn(); },
    clear: function() { inv(); return raw().clear(); },
  };
  _reqSheets[name] = w;
  return w;
}
function getSS() {
  if (_SS) return _SS;
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try { _SS = SpreadsheetApp.openById(SPREADSHEET_ID); return _SS; }
    catch (e) { lastErr = e; Utilities.sleep(400 * (i + 1)); }
  }
  try {   // skrip menempel di Sheet ini → jalur cadangan
    const a = SpreadsheetApp.getActiveSpreadsheet();
    if (a && a.getId() === SPREADSHEET_ID) { _SS = a; return _SS; }
  } catch (e) {}
  throw lastErr;
}

function getSheet(name) {
  return wrapSheet(name, function() {
    const ss = getSS();
    let s = ss.getSheetByName(name);
    if (!s) throw new Error('Sheet "' + name + '" tidak ditemukan. Jalankan setupSheets() atau migrateV4() dulu.');
    return s;
  });
}

// ── Nomor bukti: wajib unik (syarat LPDH PPK). Kosong → aplikasi membuat nomor unik; "-" ditolak. ──
function normNB(v) { return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ''); }
// Hasil: { value } atau { error }. kecualiId = transaksi yang sedang diubah (boleh memakai nomornya sendiri).
function siapkanNoBukti(raw, dapurId, tanggal, kecualiId) {
  const s = String(raw == null ? '' : raw).trim();
  const sh = getSheet(SHEETS.TRANSAKSI);
  const ids = sh.getDataRange().getValues().map(function(r) { return r[0]; });
  const tampil = sh.getRange(1, 4, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  const dipakai = {};
  for (let i = 1; i < ids.length; i++) if (ids[i] && ids[i] !== kecualiId) dipakai[normNB(tampil[i] && tampil[i][0])] = i;
  if (s === '') {
    const d = getDapur().data.find(function(x) { return x.id === dapurId; }) || {};
    const awalan = (d.kode || dapurId || 'SPPG') + '-' + String(tanggal || todayStr()).substring(0, 10).replace(/-/g, '') + '-';
    for (let n = 1; n < 10000; n++) { const c = awalan + String(n).padStart(3, '0'); if (!(normNB(c) in dipakai)) return { value: c, otomatis: true }; }
  }
  if (/^[\s\-\u2013\u2014_.\/]*$/.test(s)) return { error: 'Nomor bukti tidak boleh "' + s + '". Kosongkan bila nota tidak bernomor — aplikasi membuatkan nomor unik.' };
  if (normNB(s) in dipakai) return { error: 'Nomor bukti "' + s + '" sudah dipakai transaksi lain. Bila notanya memang berbeda (mis. dari toko lain), tambahkan kode toko, cth. ' + s + '-TOKOA.' };
  return { value: s };
}

function nbTampil(rowIndex) { return String(getSheet(SHEETS.TRANSAKSI).getRange(rowIndex, 4, 1, 1).getDisplayValues()[0][0] || ''); }
// Nomor bukti tidak diubah → data lama (yang mungkin kembar) tetap boleh diedit bagian lainnya
function nbBerubah(baru, rowIndex) { return normNB(baru) !== normNB(nbTampil(rowIndex)); }

// Nomor bukti seperti "01-2026" atau "1/10" diubah Google Sheets menjadi tanggal/angka → simpan sebagai teks
function teksSel(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[\d\s\/\-.,:]+$/.test(s) && s !== '' ? "'" + s : s;
}
function formatDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.length >= 10 ? d.substring(0, 10) : d;
  if (d instanceof Date) return Utilities.formatDate(d, 'GMT+7', 'yyyy-MM-dd');
  return String(d);
}

function formatTimestamp(d) {
  if (!d) return '';
  if (d instanceof Date) return Utilities.formatDate(d, 'GMT+7', "yyyy-MM-dd'T'HH:mm:ss");
  return String(d);
}

function logActivity(userId, action, ref) {
  try { getSheet(SHEETS.LOG).appendRow([new Date(), userId || '', action, ref || '']); }
  catch (e) { /* ignore */ }
}

// ============================================================
//  LPDH — Laporan Penggunaan Dana Harian (format PPK)
//  IdentitasLPDH (dibuat otomatis): dapur_id | id_sppg | desa | kecamatan | kabupaten | provinsi | yayasan
//    | no_va | bank | pengawas_nama | pengawas_nik | kepala_nama | kepala_nip | wakil_nama | wakil_nik | updated_at | updated_by
// ============================================================
const LPDH_FIELDS = ['id_sppg', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'yayasan', 'no_va', 'bank',
  'pengawas_nama', 'pengawas_nik', 'kepala_nama', 'kepala_nip', 'wakil_nama', 'wakil_nik', 'bast_folder'];

function lpdhSheet() {
  return wrapSheet(SHEETS.LPDH, function() {
    const ss = getSS();
    let s = ss.getSheetByName(SHEETS.LPDH);
    if (!s) {
      s = ss.insertSheet(SHEETS.LPDH);
      s.appendRow(['dapur_id'].concat(LPDH_FIELDS, ['updated_at', 'updated_by']));
    }
    return s;
  });
}
// akuntan/pic hanya dapurnya sendiri; admin & yayasan memilih dapur
function lpdhDapur(me, dapur) {
  if (me.role === 'akuntan' || me.role === 'pic' || me.role === 'aslap') return me.dapur || null;
  if (me.role === 'admin' || me.role === 'yayasan') return String(dapur || '') || null;
  return null;
}
function readIdentitasLPDH(dapurId) {
  const d = lpdhSheet().getDataRange().getValues();
  for (let i = 1; i < d.length; i++) {
    if (d[i][0] === dapurId) {
      const o = { _row: i + 1 };
      LPDH_FIELDS.forEach(function(f, k) { o[f] = String(d[i][k + 1] == null ? '' : d[i][k + 1]).replace(/^'/, ''); });
      // baris lama (sebelum ada kolom folder BAST) berisi tanggal di kolom ini
      if (!/^https:\/\//.test(o.bast_folder)) o.bast_folder = '';
      return o;
    }
  }
  return null;
}
function getIdentitasLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const o = readIdentitasLPDH(dapurId) || {};
  delete o._row;
  return { ok: true, data: o };
}
function saveIdentitasLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (['admin', 'akuntan', 'pic'].indexOf(me.role) < 0) return { ok: false, error: 'Hanya admin, akuntan, atau PIC' };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId || !getDapur().data.some(function(x) { return x.id === dapurId; })) return { ok: false, error: 'Pilih dapur' };
  const v = {};
  LPDH_FIELDS.forEach(function(f) { v[f] = String(p[f] == null ? '' : p[f]).trim(); });
  const cekAngka = function(val, n, label) { return !val || new RegExp('^\\d{' + n + '}$').test(val) ? null : label + ' harus ' + n + ' digit angka'; };
  if (v.bast_folder && !/^https:\/\//.test(v.bast_folder)) return { ok: false, error: 'Link folder BAST harus diawali https://' };
  const err = cekAngka(v.pengawas_nik, 16, 'NIK Pengawas Keuangan') || cekAngka(v.kepala_nip, 18, 'NIP Kepala SPPG') || cekAngka(v.wakil_nik, 16, 'NIK Perwakilan Yayasan');
  if (err) return { ok: false, error: err };
  return withLock(function() {
    const sh = lpdhSheet();
    // angka panjang (NIK/NIP/VA) disimpan sebagai teks agar tidak berubah jadi 1,87E+15
    const row = [dapurId].concat(LPDH_FIELDS.map(function(f) { return /^\d+$/.test(v[f]) ? "'" + v[f] : v[f]; }), [new Date(), me.id]);
    const ada = readIdentitasLPDH(dapurId);
    if (ada) sh.getRange(ada._row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    logActivity(me.id, 'saveIdentitasLPDH', dapurId);
    return { ok: true };
  });
}

// ── Data harian (A_PM porsi POP/Fleet + syarat insentif) diisi PIC; isian hari baru disalin dari hari sebelumnya ──
//  LPDHHarian: dapur_id | tanggal | data_json | updated_at | updated_by
const LPDH_KELOMPOK = ['KS-01', 'KS-02', 'KS-03', 'KS-04', 'KS-05', 'KS-06', 'KS-07', 'KS-08', 'KS-09', 'PTK'];
const LPDH_ALASAN = ['Kualitas tidak layak/tidak standar', 'Kemasan rusak/tumpah', 'PM tidak hadir', 'Libur/kegiatan mendadak',
  'Keterlambatan pengiriman', 'Kelebihan kirim/dikembalikan', 'Lainnya'];
const LPDH_SYARAT = ['kontaminasi', 'fatal', 'suspend', 'verifikasi', 'sipgn'];
function sheetOtomatis(nama, header) {
  return wrapSheet(nama, function() {
    const ss = getSS();
    let s = ss.getSheetByName(nama);
    if (!s) { s = ss.insertSheet(nama); s.appendRow(header); }
    return s;
  });
}
function bacaJson(v) { try { return JSON.parse(v); } catch (e) { return null; } }
function harianSheet() { return sheetOtomatis(SHEETS.LPDH_HARIAN, ['dapur_id', 'tanggal', 'data_json', 'updated_at', 'updated_by']); }
function bacaHarian(dapurId, tgl) {
  const d = harianSheet().getDataRange().getValues();
  let tepat = null, sebelum = null;
  for (let i = 1; i < d.length; i++) {
    if (d[i][0] !== dapurId) continue;
    const t = formatDate(d[i][1]);
    const rec = { _row: i + 1, tanggal: t, data: bacaJson(d[i][2]) };
    if (t === tgl) tepat = rec;
    else if (t < tgl && (!sebelum || t > sebelum.tanggal)) sebelum = rec;
  }
  return { tepat: tepat, sebelum: sebelum };
}
function bisaIsiLPDH(me) { return ['admin', 'akuntan', 'pic'].indexOf(me.role) >= 0; }
function bisaCatatLapangan(me) { return ['admin', 'akuntan', 'pic', 'aslap'].indexOf(me.role) >= 0; }
function pmRencanaTanggal(dapurId, tgl) {
  const per = readAllPeriode(dapurId).find(function(r) { return tgl >= r.tanggal_mulai && tgl <= r.tanggal_akhir; });
  if (!per) return { pm: null, libur: false };
  const r = bacaRencana(dapurId, per.id), d = r && r.data ? r.data : {};
  const h = (d.hari || {})[tgl] || {};
  const dow = new Date(tgl + 'T00:00:00Z').getUTCDay();
  const libur = h.libur !== undefined ? !!h.libur : (dow === 0 || dow === 6);
  return { pm: libur ? 0 : (h.pm > 0 ? Number(h.pm) : Number(per.penerima) || 0), libur: libur };
}
function getHarianLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  const tgl = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, error: 'Pilih dapur & tanggal' };
  const h = bacaHarian(dapurId, tgl);
  const pmR = pmRencanaTanggal(dapurId, tgl);
  if (h.tepat) return { ok: true, data: { data: h.tepat.data, sumber: 'tersimpan', pmRencana: pmR.pm, liburRencana: pmR.libur } };
  if (h.sebelum && h.sebelum.data) {
    // salin dari hari sebelumnya, KECUALI nomor & link BAST (bukti harian tidak boleh disalin)
    const salin = JSON.parse(JSON.stringify(h.sebelum.data));
    (salin.pm || []).forEach(function(r) { r.bast = ''; r.link = ''; });
    return { ok: true, data: { data: salin, sumber: 'disalin dari ' + h.sebelum.tanggal, pmRencana: pmR.pm, liburRencana: pmR.libur } };
  }
  return { ok: true, data: { data: null, sumber: 'baru', pmRencana: pmR.pm, liburRencana: pmR.libur } };
}
function cekHarian(raw) {
  let d = raw;
  if (typeof d === 'string') { d = bacaJson(d); if (!d) return { error: 'Format data harian tidak valid' }; }
  const bulat = function(v) { const n = Number(v); return v === '' || v == null ? 0 : (Number.isInteger(n) && n >= 0 ? n : NaN); };
  const out = { pm: [], produksi: {}, syarat: {}, sekolah: [] };
  // porsi per sekolah/penerima (format POP) — dasar kelompok sasaran; disalin ke hari berikutnya sebagai daftar awal (dikirim=false tetap disimpan sebagai basis data)
  const JENJANG_PM = ['B3_HAMIL', 'B3_MENYUSUI', 'PAUD', 'SD', 'SMP', 'SMA', 'SANTRI', 'PTK'];
  if ((d.sekolah || []).length > 100) return { error: 'Maksimal 100 sekolah/penerima per hari' };
  for (let i = 0; i < (d.sekolah || []).length; i++) {
    const x = d.sekolah[i] || {}, o = { nama: String(x.nama || '').trim().substring(0, 80), jenjang: String(x.jenjang || ''), besar: bulat(x.besar), kecil: bulat(x.kecil), dikirim: x.dikirim !== false };
    if (!o.nama) return { error: 'Sekolah baris ' + (i + 1) + ': nama wajib' };
    if (JENJANG_PM.indexOf(o.jenjang) < 0) return { error: o.nama + ': pilih jenjang/kelompok' };
    if (isNaN(o.besar) || isNaN(o.kecil)) return { error: o.nama + ': porsi harus bilangan bulat ≥ 0' };
    out.sekolah.push(o);
  }
  const pmIn = {}; (d.pm || []).forEach(function(r) { if (r && r.kode) pmIn[r.kode] = r; });
  for (let i = 0; i < LPDH_KELOMPOK.length; i++) {
    const k = LPDH_KELOMPOK[i], r = pmIn[k] || {};
    const o = { kode: k, target: bulat(r.target), distribusi: bulat(r.distribusi), diterima: bulat(r.diterima), tidak: bulat(r.tidak),
      alasan: String(r.alasan || ''), bnba: r.bnba === 'Ya' ? 'Ya' : r.bnba === 'Tidak' ? 'Tidak' : '', bast: String(r.bast || '').trim(), link: String(r.link || '').trim() };
    if ([o.target, o.distribusi, o.diterima, o.tidak].some(function(x) { return isNaN(x); })) return { error: k + ': jumlah porsi harus bilangan bulat ≥ 0' };
    if (o.alasan && LPDH_ALASAN.indexOf(o.alasan) < 0) return { error: k + ': alasan tidak dikenal' };
    if (o.link && !/^https:\/\//.test(o.link)) return { error: k + ': link BAST harus diawali https://' };
    out.pm.push(o);
  }
  ['total', 'organoleptik', 'sampel', 'tidak_terdistribusi', 'buffer'].forEach(function(k) { out.produksi[k] = bulat((d.produksi || {})[k]); });
  if (Object.keys(out.produksi).some(function(k) { return isNaN(out.produksi[k]); })) return { error: 'Data produksi harus bilangan bulat ≥ 0' };
  LPDH_SYARAT.forEach(function(k) { const v = (d.syarat || {})[k]; out.syarat[k] = v === 'Ya' || v === 'Tidak' ? v : ''; });
  return { value: out };
}
function saveHarianLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaCatatLapangan(me)) return { ok: false, error: 'Hanya PIC, aslap, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur);
  const tgl = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, error: 'Pilih dapur & tanggal' };
  const c = cekHarian(p.data);
  if (c.error) return { ok: false, error: c.error };
  return withLock(function() {
    const sh = harianSheet(), h = bacaHarian(dapurId, tgl);
    const row = [dapurId, tgl, JSON.stringify(c.value), new Date(), me.id];
    if (h.tepat) sh.getRange(h.tepat._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    logActivity(me.id, 'saveHarianLPDH', dapurId + ' ' + tgl);
    return { ok: true };
  });
}

// ── Daftar penerima honor relawan per transaksi (LPDH sheet C1). Diisi sekali; pembayaran berikutnya disalin ──
//  RelawanBayar: transaksi_id | dapur_id | data_json | updated_at | updated_by
function relawanSheet() { return sheetOtomatis(SHEETS.RELAWAN, ['transaksi_id', 'dapur_id', 'data_json', 'updated_at', 'updated_by']); }
function bacaRelawanSemua(dapurId) {
  const d = relawanSheet().getDataRange().getValues(), out = {};
  for (let i = 1; i < d.length; i++) if (d[i][1] === dapurId) out[d[i][0]] = { _row: i + 1, rows: bacaJson(d[i][2]) || [], seq: i };
  return out;
}
function isHonorRelawan(t) { return t && t.jenis === 'Operasional' && /^gaji\/honor relawan/i.test(String(t.kategori || '')); }
function getRelawanBayar(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const tx = findTx(p.transaksi_id);
  if (!tx || !isHonorRelawan(tx)) return { ok: false, error: 'Transaksi honor relawan tidak ditemukan' };
  if (lpdhDapur(me, tx.dapur) !== tx.dapur) return { ok: false, error: 'Bukan dapur Anda' };
  const semua = bacaRelawanSemua(tx.dapur);
  if (semua[tx.id]) return { ok: true, data: { rows: semua[tx.id].rows.map(function(r) { return Object.assign({ hadir: true }, r); }), sumber: 'tersimpan', total: tx.riil } };
  // daftar relawan tetap (diatur di Setup) bila ada — centang mengikuti 'biasanya hadir'; selain itu salin dari daftar terakhir (semua dicentang)
  const tetap = { rows: relawanTetapRows(tx.dapur, semua) };
  if (tetap.rows.length) return { ok: true, data: { rows: tetap.rows.map(function(r) { return Object.assign({}, r, { hadir: r.hadir !== false, hari: r.hari > 0 ? r.hari : 1 }); }),
    sumber: 'disalin dari daftar relawan tetap', total: tx.riil } };
  let akhir = null; Object.keys(semua).forEach(function(k) { if (k.indexOf(RELAWAN_TETAP) === 0) return; if (!akhir || semua[k].seq > akhir.seq) akhir = semua[k]; });
  return { ok: true, data: { rows: akhir ? akhir.rows.map(function(r) { return Object.assign({}, r, { hadir: true, hari: r.hari > 0 ? r.hari : 1 }); }) : [],
    sumber: akhir ? 'disalin dari daftar terakhir' : 'baru', total: tx.riil } };
}
function saveRelawanBayar(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const tx = findTx(p.transaksi_id);
  if (!tx || !isHonorRelawan(tx)) return { ok: false, error: 'Transaksi honor relawan tidak ditemukan' };
  if (lpdhDapur(me, tx.dapur) !== tx.dapur) return { ok: false, error: 'Bukan dapur Anda' };
  let a = p.rows;
  if (typeof a === 'string') a = bacaJson(a);
  if (!Array.isArray(a) || !a.length) return { ok: false, error: 'Daftar relawan kosong' };
  if (a.length > 200) return { ok: false, error: 'Daftar relawan maksimal 200 orang' };
  // daftar lengkap disimpan (termasuk yang tidak hadir, agar dipakai lagi); yang dibayar = yang hadir
  const rows = []; let total = 0, nHadir = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {}, r = { nama: String(x.nama || '').trim(), tugas: String(x.tugas || '').trim(), hari: Number(x.hari) || 0, upah: Number(x.upah) || 0,
      metode: x.metode === 'Tunai' ? 'Tunai' : 'Transfer', hadir: x.hadir !== false && x.hadir !== 'false' };
    if (!r.nama) return { ok: false, error: 'Baris ' + (i + 1) + ': nama wajib' };
    if (r.hadir && (!(r.hari > 0) || !(r.upah > 0))) return { ok: false, error: 'Baris ' + (i + 1) + ' (' + r.nama + '): hari kerja & upah harian wajib > 0' };
    if (r.hadir) { total += r.hari * r.upah; nHadir++; }
    rows.push(r);
  }
  if (!nHadir) return { ok: false, error: 'Belum ada relawan yang dicentang hadir' };
  if (nHadir > 60) return { ok: false, error: 'Maksimal 60 relawan dibayar per transaksi (kapasitas lembar C1 PPK)' };
  if (Math.round(total) !== Math.round(tx.riil)) return { ok: false, error: 'Total daftar ' + rupiah(total) + ' ≠ nilai transaksi ' + rupiah(tx.riil) + ' (selisih ' + rupiah(total - tx.riil) + ')' };
  return withLock(function() {
    const sh = relawanSheet(), ada = bacaRelawanSemua(tx.dapur)[tx.id];
    const row = [tx.id, tx.dapur, JSON.stringify(rows), new Date(), me.id];
    if (ada) sh.getRange(ada._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    logActivity(me.id, 'saveRelawanBayar', tx.id + ' (' + rows.length + ' orang)');
    return { ok: true };
  });
}

// ── Daftar relawan tetap per dapur: bisa diubah kapan saja (tidak menunggu realisasi honor) ──
const RELAWAN_TETAP = 'DAFTAR:';
function bacaBarisRelawan(a, wajibHadir) {
  if (typeof a === 'string') a = bacaJson(a);
  if (!Array.isArray(a)) return { error: 'Daftar relawan tidak valid' };
  if (a.length > 200) return { error: 'Daftar relawan maksimal 200 orang' };
  const rows = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {}, r = { nama: String(x.nama || '').trim().substring(0, 80), tugas: String(x.tugas || '').trim().substring(0, 60), hari: Number(x.hari) || 1,
      upah: Math.round(Number(x.upah) || 0), metode: x.metode === 'Tunai' ? 'Tunai' : 'Transfer', hadir: x.hadir !== false && x.hadir !== 'false' };
    if (!r.nama) return { error: 'Baris ' + (i + 1) + ': nama wajib' };
    if (!(r.upah > 0)) return { error: 'Baris ' + (i + 1) + ' (' + r.nama + '): upah per hari wajib > 0' };
    rows.push(r);
  }
  return { rows: rows };
}
// Daftar relawan tetap = Data Penerima jenis RELAWAN (fitur Data Penerima); data lama (DAFTAR:<dapur>) dipakai bila belum ada
function relawanTetapRows(dapurId, semua) {
  const dp = bacaDataPenerima(dapurId).filter(function(x) { return x.jenis === 'RELAWAN'; });
  if (dp.length) return dp.map(function(x) { return { id: x.id, nama: x.nama, tugas: x.jabatan, hari: 1, upah: x.nominal, metode: x.metode, hadir: x.aktif }; });
  const lama = (semua || bacaRelawanSemua(dapurId))[RELAWAN_TETAP + dapurId];
  return lama ? lama.rows : [];
}
function getRelawanTetap(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const semua = bacaRelawanSemua(dapurId), tetap = relawanTetapRows(dapurId, semua);
  if (tetap.length) return { ok: true, data: { rows: tetap, sumber: 'tetap' } };
  let akhir = null; Object.keys(semua).forEach(function(k) { if (k.indexOf(RELAWAN_TETAP) === 0) return; if (!akhir || semua[k].seq > akhir.seq) akhir = semua[k]; });
  return { ok: true, data: { rows: akhir ? akhir.rows.map(function(r) { return Object.assign({}, r, { hadir: true }); }) : [], sumber: akhir ? 'dari pembayaran terakhir' : 'baru' } };
}
function saveRelawanTetap(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const b = bacaBarisRelawan(p.rows);
  if (b.error) return { ok: false, error: b.error };
  return withLock(function() {
    // disimpan ke Data Penerima (jenis RELAWAN): cocokkan per nama agar tanda tangan tersimpan tetap terhubung
    const sh = dataPenerimaSheet(), lama = bacaDataPenerima(dapurId).filter(function(x) { return x.jenis === 'RELAWAN'; });
    const dipakai = {};
    b.rows.forEach(function(r) {
      const ada = lama.find(function(x) { return !dipakai[x.id] && x.nama.toLowerCase() === r.nama.toLowerCase(); });
      const id = ada ? ada.id : idUnik('DP'); dipakai[id] = 1;
      const baris = [id, dapurId, 'RELAWAN', r.nama, r.tugas, '', 0, r.upah, r.metode, r.hadir ? 'YA' : 'TIDAK', new Date(), me.id];
      if (ada) sh.getRange(ada._row, 1, 1, baris.length).setValues([baris]); else sh.appendRow(baris);
    });
    lama.filter(function(x) { return !dipakai[x.id]; }).sort(function(a, c) { return c._row - a._row; }).forEach(function(x) {
      sh.deleteRow(x._row);
      const props = PropertiesService.getScriptProperties(), fid = props.getProperty(ttdKey('P_' + x.id));
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} props.deleteProperty(ttdKey('P_' + x.id)); }
    });
    PropertiesService.getScriptProperties().setProperty('dp_impor_' + dapurId, 'setup');
    logActivity(me.id, 'saveRelawanTetap', dapurId + ' (' + b.rows.length + ' orang)');
    return { ok: true, data: { jumlah: b.rows.length, perHari: b.rows.filter(function(r) { return r.hadir; }).reduce(function(a, r) { return a + r.upah * (r.hari || 1); }, 0) } };
  });
}

// ── Kelengkapan LPDH yang berasal dari dokumen luar (diisi sekali di aplikasi, otomatis masuk ke file) ──
function bisaKelengkapan(me) { return me.role === 'admin' || me.role === 'akuntan'; }
// Top up VA: nomor SP2D/referensi PPK, nomor kuitansi/bukti terima, link bukti terima
function saveTopupLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaKelengkapan(me)) return { ok: false, error: 'Hanya akuntan atau admin' };
  const t = readVATopups(null).find(function(x) { return x.id === p.id; });
  if (!t) return { ok: false, error: 'Top up tidak ditemukan' };
  if (me.role === 'akuntan' && t.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
  const bukti = String(p.bukti_url || '').trim();
  if (bukti && !/^https:\/\//.test(bukti)) return { ok: false, error: 'Link bukti terima harus diawali https://' };
  getSheet(SHEETS.VA).getRange(t._row, 9, 1, 3).setValues([[teksSel(p.no_sp2d || ''), teksSel(p.no_kuitansi || ''), bukti]]);
  logActivity(me.id, 'saveTopupLPDH', t.id);
  return { ok: true };
}
// Pembayaran insentif ke Mitra/Yayasan (transaksi Fasilitas SPPG): pernyataan PPK & kuitansi
//  InsentifBayar: transaksi_id | dapur_id | data_json | updated_at | updated_by
function insentifSheet() { return sheetOtomatis(SHEETS.INSENTIF, ['transaksi_id', 'dapur_id', 'data_json', 'updated_at', 'updated_by']); }
function bacaInsentifSemua(dapurId) {
  const d = insentifSheet().getDataRange().getValues(), out = {};
  for (let i = 1; i < d.length; i++) if (d[i][1] === dapurId) out[d[i][0]] = { _row: i + 1, data: bacaJson(d[i][2]) || {} };
  return out;
}
function saveInsentifLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaKelengkapan(me)) return { ok: false, error: 'Hanya akuntan atau admin' };
  const tx = findTx(p.transaksi_id);
  if (!tx || tx.jenis !== 'Fasilitas SPPG') return { ok: false, error: 'Transaksi insentif (Fasilitas SPPG) tidak ditemukan' };
  if (me.role === 'akuntan' && tx.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
  const nilai = p.nilai_ppk === '' || p.nilai_ppk == null ? '' : Number(p.nilai_ppk);
  if (nilai !== '' && !(nilai >= 0)) return { ok: false, error: 'Nilai pernyataan PPK tidak valid' };
  const d = { no_ppk: String(p.no_ppk || '').trim(), nilai_ppk: nilai, no_kuitansi: String(p.no_kuitansi || '').trim(),
    kuitansi_ttd: p.kuitansi_ttd === 'Ya' ? 'Ya' : p.kuitansi_ttd === 'Tidak' ? 'Tidak' : '', ref_va: String(p.ref_va || '').trim() };
  return withLock(function() {
    const sh = insentifSheet(), ada = bacaInsentifSemua(tx.dapur)[tx.id];
    if (ada && ada.data.ttd_url) d.ttd_url = ada.data.ttd_url;
    const row = [tx.id, tx.dapur, JSON.stringify(d), new Date(), me.id];
    if (ada) sh.getRange(ada._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    logActivity(me.id, 'saveInsentifLPDH', tx.id);
    return { ok: true };
  });
}
// Kuitansi insentif yang sudah ditandatangani Mitra/Yayasan, diunggah PIC (atau akuntan/admin)
function saveTtdInsentif(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const tx = findTx(p.transaksi_id);
  if (!tx || tx.jenis !== 'Fasilitas SPPG') return { ok: false, error: 'Transaksi insentif (Fasilitas SPPG) tidak ditemukan' };
  if (lpdhDapur(me, tx.dapur) !== tx.dapur) return { ok: false, error: 'Bukan dapur Anda' };
  const url = String(p.ttd_url || '').trim();
  if (!/^https:\/\//.test(url)) return { ok: false, error: 'File kuitansi bertanda tangan belum terunggah' };
  return withLock(function() {
    const sh = insentifSheet(), ada = bacaInsentifSemua(tx.dapur)[tx.id];
    const d = Object.assign({}, ada ? ada.data : {}, { ttd_url: url, kuitansi_ttd: 'Ya' });
    const row = [tx.id, tx.dapur, JSON.stringify(d), new Date(), me.id];
    if (ada) sh.getRange(ada._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    logActivity(me.id, 'saveTtdInsentif', tx.id);
    return { ok: true };
  });
}
// Nomor pernyataan PPK terakhir yang diketik untuk dapur ini (dipakai lagi sampai diganti)
function ppkTerakhir(dapurId, semua) {
  let akhir = null;
  Object.keys(semua).forEach(function(k) { const x = semua[k]; if (x.data && x.data.no_ppk && (!akhir || x._row > akhir._row)) akhir = x; });
  return akhir ? akhir.data.no_ppk : '';
}

// Saldo VA menurut mutasi rekening (diketik dari mobile banking/rekening koran) + penjelasan selisih, per dapur per hari
//  LPDHSaldo: dapur_id | tanggal | saldo_va | penjelasan | updated_at | updated_by
function saldoSheet() { return sheetOtomatis(SHEETS.LPDH_SALDO, ['dapur_id', 'tanggal', 'saldo_va', 'penjelasan', 'updated_at', 'updated_by']); }
function bacaSaldoRek(dapurId, tgl) {
  const d = saldoSheet().getDataRange().getValues();
  for (let i = 1; i < d.length; i++) if (d[i][0] === dapurId && formatDate(d[i][1]) === tgl)
    return { _row: i + 1, saldo_va: d[i][2] === '' ? null : Number(d[i][2]), penjelasan: String(d[i][3] || '') };
  return null;
}
function saveSaldoLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaKelengkapan(me)) return { ok: false, error: 'Hanya akuntan atau admin' };
  const dapurId = lpdhDapur(me, p.dapur);
  const tgl = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, error: 'Pilih dapur & tanggal' };
  const saldo = Number(p.saldo_va);
  if (p.saldo_va === '' || p.saldo_va == null || isNaN(saldo)) return { ok: false, error: 'Saldo VA wajib diisi (angka)' };
  return withLock(function() {
    const sh = saldoSheet(), ada = bacaSaldoRek(dapurId, tgl);
    const row = [dapurId, tgl, saldo, String(p.penjelasan || '').trim(), new Date(), me.id];
    if (ada) sh.getRange(ada._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    logActivity(me.id, 'saveSaldoLPDH', dapurId + ' ' + tgl);
    return { ok: true };
  });
}

// ── Saldo per komponen (0 Bahan Baku, 1 Operasional, 2 Insentif) bersambung dari hari ke hari ──
// Format PPK memisah saldo per komponen walau VA hanya satu rekening. Aturan:
//  1. Saldo awal tiap periode (ditetapkan akuntan) dibagi menurut pola belanja nyata sejauh ini;
//     periode pertama memakai rasio pagu PPK (bahan 10.000 : operasional 3.000 : insentif 2.000).
//  2. Tiap hari: top up dipakai dulu menutup komponen yang kurang untuk pengeluaran hari itu, sisanya
//     mendekatkan saldo ke pola belanja nyata sampai hari sebelumnya (belum ada riwayat → rasio pagu),
//     supaya komponen yang paling sering dipakai tidak cepat habis.
//  3. Bila masih kurang → digeser dari komponen lain (dicatat; perlu persetujuan tertulis PPK). Saldo komponen tidak negatif
//     selama total saldo cukup.
const LPDH_RASIO = [10, 3, 2];
const LPDH_KOMP = ['Bahan Baku', 'Operasional', 'Insentif'];
function lpdhKompIdx(jenis) { return jenis === 'Bahan Baku' ? 0 : jenis === 'Fasilitas SPPG' ? 2 : 1; }
function bagiRupiah(total, bobot) {
  const sum = bobot.reduce(function(a, b) { return a + b; }, 0);
  if (!(sum > 0)) return [total, 0, 0];
  const r = bobot.map(function(b) { return Math.floor(total * b / sum); });
  let iMax = 0; bobot.forEach(function(b, i) { if (b > bobot[iMax]) iMax = i; });
  r[iMax] += total - r.reduce(function(a, b) { return a + b; }, 0);
  return r;
}
// LPDH memakai nilai anggaran pengajuan (unriil); data tanpa anggaran → realisasi aktual
function nilaiLPDH(t) { return Number(t.unriil) > 0 ? Number(t.unriil) : (Number(t.riil) || 0); }
// pre (opsional): { per, tx, tu } yang sudah dibaca pemanggil → sheet tidak dibaca dua kali
function komponenLPDH(dapurId, tgl, pre) {
  pre = pre || {};
  const per = (pre.per || readAllPeriode(dapurId)).filter(function(r) { return r.tanggal_mulai <= tgl; })
    .sort(function(a, b) { return a.tanggal_mulai < b.tanggal_mulai ? -1 : 1; });
  const allTx = pre.tx || readAllTransaksi([dapurId]);
  const allTu = pre.tu || readVATopups(dapurId);
  let bal = null, hasil = null;
  const riwayat = [0, 0, 0];   // total belanja per komponen sampai hari sebelumnya (semua periode)
  per.forEach(function(pr) {
    const total0 = pr.saldoVA + pr.saldoPettyAwal;
    // awal periode = alokasi baru: dibagi menurut pola belanja nyata sejauh ini (belum ada riwayat → rasio pagu)
    bal = bagiRupiah(total0, riwayat[0] + riwayat[1] + riwayat[2] > 0 ? riwayat : LPDH_RASIO);
    const hari = {};
    const akhir = pr.tanggal_akhir < tgl ? pr.tanggal_akhir : tgl;
    allTx.forEach(function(t) { if (t.periode_id === pr.id && t.tanggal <= akhir) { const h = hari[t.tanggal] = hari[t.tanggal] || { sp: [0, 0, 0], tu: [] }; h.sp[lpdhKompIdx(t.jenis)] += nilaiLPDH(t); } });
    allTu.forEach(function(t) { if (t.periode_id === pr.id && t.tanggal <= akhir) { const h = hari[t.tanggal] = hari[t.tanggal] || { sp: [0, 0, 0], tu: [] }; h.tu.push(t); } });
    Object.keys(hari).sort().forEach(function(d) {
      const h = hari[d], sp = h.sp;
      const awal = bal.slice();
      const T = h.tu.reduce(function(s, t) { return s + t.jumlah; }, 0);
      // 2. top up: tutup kekurangan dulu, sisanya sesuai porsi pengeluaran
      const kurang = sp.map(function(x, k) { return Math.max(0, x - bal[k]); });
      const sumK = kurang[0] + kurang[1] + kurang[2];
      let alok = sumK >= T ? bagiRupiah(T, kurang) : kurang.slice();
      if (sumK < T) {
        // sisa top up → isi komponen yang paling jauh di bawah porsi targetnya
        const pola = riwayat[0] + riwayat[1] + riwayat[2] > 0 ? riwayat : LPDH_RASIO;
        const sumPola = pola[0] + pola[1] + pola[2];
        const totalSetelah = bal[0] + bal[1] + bal[2] + T - (sp[0] + sp[1] + sp[2]);
        const posisi = bal.map(function(b, k) { return b + kurang[k] - sp[k]; });   // saldo akhir bila hanya ditutup kekurangannya
        const celah = posisi.map(function(x, k) { return Math.max(0, totalSetelah * pola[k] / sumPola - x); });
        const sisa = bagiRupiah(T - sumK, celah[0] + celah[1] + celah[2] > 0 ? celah : pola);
        alok = alok.map(function(a, k) { return a + sisa[k]; });
      }
      if (!(T > 0)) alok = [0, 0, 0];
      const setelahTU = bal.map(function(b, k) { return b + alok[k]; });
      // 3. pergeseran bila masih kurang (urutan sumber: komponen lain yang paling longgar)
      const geser = [];
      for (let k = 0; k < 3; k++) {
        let perlu = sp[k] - setelahTU[k];
        [0, 1, 2].filter(function(j) { return j !== k; }).sort(function(a, b) { return (setelahTU[b] - sp[b]) - (setelahTU[a] - sp[a]); }).forEach(function(j) {
          const luang = setelahTU[j] - sp[j];
          if (perlu > 0 && luang > 0) { const x = Math.min(perlu, luang); setelahTU[j] -= x; setelahTU[k] += x; perlu -= x; geser.push({ dari: j, ke: k, jumlah: x }); }
        });
      }
      // bagi tiap baris top up sesuai alokasi total
      let sisaAlok = alok.slice();
      const baris = h.tu.map(function(t, i) {
        const b = i === h.tu.length - 1 ? sisaAlok.slice() : bagiRupiah(t.jumlah, alok);
        sisaAlok = sisaAlok.map(function(x, k) { return x - b[k]; });
        return { id: t.id, tanggal: t.tanggal, jumlah: t.jumlah, keterangan: t.keterangan, bagi: b,
          no_sp2d: t.no_sp2d, no_kuitansi: t.no_kuitansi, bukti_url: t.bukti_url };
      });
      if (d === tgl) {
        // pergeseran dicatat di saldo awal hari itu (jumlah total tidak berubah)
        const awalGeser = awal.slice();
        geser.forEach(function(g) { awalGeser[g.dari] -= g.jumlah; awalGeser[g.ke] += g.jumlah; });
        hasil = { awal: awalGeser, awalSebelumGeser: awal, topups: baris, geser: geser };
      }
      bal = setelahTU.map(function(b, k) { return b - sp[k]; });
      sp.forEach(function(x, k) { riwayat[k] += x; });
    });
  });
  if (!hasil) hasil = { awal: bal || [0, 0, 0], awalSebelumGeser: bal || [0, 0, 0], topups: [], geser: [] };
  hasil.nama = LPDH_KOMP;
  return hasil;
}

// Data satu hari untuk LPDH: transaksi bertanggal hari itu, saldo awal hari itu, dan top up hari itu.
// Uang yang dihitung = riil (uang yang benar-benar keluar), karena LPDH dicocokkan dengan mutasi rekening.
function getDataLPDH(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const tgl = String(p.tanggal || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, error: 'Tanggal tidak valid' };
  const dapur = getDapur().data.find(function(x) { return x.id === dapurId; });
  if (!dapur) return { ok: false, error: 'Dapur tidak ditemukan' };
  const semuaPer = readAllPeriode(dapurId);
  const periode = semuaPer.find(function(r) { return tgl >= r.tanggal_mulai && tgl <= r.tanggal_akhir; });
  if (!periode) return { ok: false, error: 'Tanggal ' + tgl + ' tidak berada di periode mana pun' };

  // dibaca sekali untuk semua periode (dipakai juga oleh perhitungan saldo per komponen)
  const semuaTx = readAllTransaksi([dapurId]), semuaTu = readVATopups(dapurId);
  const tx = semuaTx.filter(function(t) { return t.periode_id === periode.id; });
  const topups = semuaTu.filter(function(t) { return t.periode_id === periode.id; });
  const sebelum = function(t) { return t.tanggal < tgl; };
  const saldoAwal = periode.saldoVA + periode.saldoPettyAwal
    + topups.filter(sebelum).reduce(function(s, t) { return s + t.jumlah; }, 0)
    - tx.filter(sebelum).reduce(function(s, t) { return s + nilaiLPDH(t); }, 0);

  const txHari = tx.filter(function(t) { return t.tanggal === tgl; });
  const adaLink = txHari.some(function(t) { return !!t.pengajuan_item_id; });
  const items = {}, heads = {};
  if (adaLink) {
    readAllItems().forEach(function(i) { items[i.id] = i; });
    readAllPengajuan().forEach(function(h) { heads[h.id] = h; });
  }
  // Nomor bukti dibaca persis seperti yang tampil di Sheet (data lama "01-2026" tersimpan sebagai tanggal),
  // cukup pada rentang baris transaksi hari itu saja (bukan seluruh sheet Transaksi).
  let minRow = 0, maxRow = 0, tampil = [];
  if (txHari.length) {
    minRow = txHari.reduce(function(m, t) { return Math.min(m, t._rowIndex); }, txHari[0]._rowIndex);
    maxRow = txHari.reduce(function(m, t) { return Math.max(m, t._rowIndex); }, txHari[0]._rowIndex);
    tampil = getSheet(SHEETS.TRANSAKSI).getRange(minRow, 4, maxRow - minRow + 1, 1).getDisplayValues();
  }
  const relawan = txHari.some(isHonorRelawan) ? bacaRelawanSemua(dapurId) : {};
  const insentif = bacaInsentifSemua(dapurId);
  const kk = konteksKw(dapurId, tgl, txHari);
  const ttdOtomatis = kk.ttdPic && kk.ttdAkn;
  const hari = txHari.map(function(t) {
    const link = String(t.pengajuan_item_id || '');
    const it = items[isFeeLink(link) ? link.substring(BIAYA_ADMIN_PREFIX.length) : link];
    const disp = tampil[t._rowIndex - minRow];
    return { id: t.id, tanggal: t.tanggal, no_bukti: String((disp && disp[0]) || t.no_bukti || ''), jenis: t.jenis, kategori: t.kategori,
      uraian: t.uraian, sumber: t.sumber, riil: nilaiLPDH(t), aktual: t.riil, bukti_url: String(t.bukti_url || ''),
      pemasok: it ? (isFeeLink(link) ? it.bank : it.penerima_nama) : '', seq: t.seq,
      rincian: it && !isFeeLink(link) && t.jenis === 'Bahan Baku' ? it.rincian : [], nota_url: it && !isFeeLink(link) ? it.nota_url : '',
      relawan: isHonorRelawan(t) && relawan[t.id] ? relawan[t.id].rows.filter(function(r) { return r.hadir !== false; }) : null,
      insentif: t.jenis === 'Fasilitas SPPG' ? Object.assign({}, insentif[t.id] ? insentif[t.id].data : {}, { ttd_otomatis: ttdOtomatis }) : null,
      ref: it && heads[it.pengajuan_id] ? heads[it.pengajuan_id].nomor + ' #' + it.urut : '',
      catatan: it && !isFeeLink(link) ? catatanAkuntanDari(it.catatan) : '' };
  }).sort(function(a, b) { return a.seq - b.seq; });

  const ident = readIdentitasLPDH(dapurId) || {};
  delete ident._row;
  return { ok: true, data: {
    dapur: { id: dapur.id, nama: dapur.nama, kode: dapur.kode }, identitas: ident,
    periode: { id: periode.id, periode_no: periode.periode_no, tanggal_mulai: periode.tanggal_mulai, tanggal_akhir: periode.tanggal_akhir, status: periode.status },
    tanggal: tgl, saldoAwal: saldoAwal, transaksi: hari, komponen: komponenLPDH(dapurId, tgl, { per: semuaPer, tx: semuaTx, tu: semuaTu }),
    harian: (function() { const h = bacaHarian(dapurId, tgl).tepat; return h ? h.data : null; })(),
    topups: topups.filter(function(t) { return t.tanggal === tgl; }).map(function(t) { return { id: t.id, tanggal: t.tanggal, jumlah: t.jumlah, keterangan: t.keterangan,
      no_sp2d: t.no_sp2d, no_kuitansi: t.no_kuitansi, bukti_url: t.bukti_url }; }),
    ppkTerakhir: ppkTerakhir(dapurId, insentif), kwitansi: (function() { const o = {}; Object.keys(kk.file).forEach(function(j) { o[j] = kk.file[j].url; }); return o; })(), kwitansiNomor: (function() {
      // nomor BASTI kwitansi PIC sekolah & kader hari itu → kolom No. Bukti LPDH
      const out = { PIC_SEKOLAH: [], KADER: [], RELAWAN: {} };
      kk.kw.filter(function(x) { return x.nomor; }).sort(function(a, b) { return a.seq - b.seq; })
        .forEach(function(x) { if (x.jenis === 'RELAWAN') out.RELAWAN[x.nama.trim().toLowerCase()] = x.nomor; else if (out[x.jenis]) out[x.jenis].push(x.nomor); });
      return out; })(),
    saldoRekening: (function() { const x = bacaSaldoRek(dapurId, tgl); return x ? { saldo_va: x.saldo_va, penjelasan: x.penjelasan } : null; })(),
  } };
}

// Gangguan sesaat dari Google (bukan salah pengguna) → pesan yang jelas & aman diulang
function pesanGangguan(msg) {
  return /tidak memiliki izin untuk mengakses dokumen|do not have permission to access the requested document|Layanan Spreadsheet gagal|Service Spreadsheets failed|Kesalahan layanan|Service error|timed out|waktu habis/i.test(String(msg || ''))
    ? 'Google menolak akses ke data (gangguan sesaat, atau penyimpanan Google Drive pemilik penuh). Cek daftar dulu, lalu coba lagi. Bila terus terjadi, hubungi admin.' : String(msg || '');
}
function logError(err) {
  try { getSheet(SHEETS.LOG).appendRow([new Date(), 'SYSTEM', 'ERROR', String(err.message || err)]); }
  catch (e) { /* ignore */ }
}

// ============================================================
//  MIGRATION V4
//  Rename SPPG: D002→Mekarsari 01, D003→Sukamukti 01, D004→Cipaku 02
//  Plus rename user nama yang masih lama
// ============================================================

function migrateV4() {
  const ss = getSS();
  const d = ss.getSheetByName(SHEETS.DAPUR);
  if (d) {
    const data = d.getDataRange().getValues();
    const renameMap = {
      'D001': 'SPPG Cipeujeuh 02',
      'D002': 'SPPG Mekarsari 01',
      'D003': 'SPPG Sukamukti 01',
      'D004': 'SPPG Cipaku 02',
    };
    for (let i = 1; i < data.length; i++) {
      if (renameMap[data[i][0]]) {
        d.getRange(i + 1, 2).setValue(renameMap[data[i][0]]);
      }
    }
  }

  // Update user names yang mengandung nama dapur lama
  const u = ss.getSheetByName(SHEETS.USERS);
  if (u) {
    const data = u.getDataRange().getValues();
    const userRenameMap = {
      'Akuntan Cipeujeuh 04': 'Akuntan Mekarsari 01',
      'Akuntan Majalaya 01': 'Akuntan Sukamukti 01',
      'Akuntan Paseh 03': 'Akuntan Cipaku 02',
      'PIC Cipeujeuh 04': 'PIC Mekarsari 01',
      'PIC Majalaya 01': 'PIC Sukamukti 01',
      'PIC Paseh 03': 'PIC Cipaku 02',
    };
    for (let i = 1; i < data.length; i++) {
      const nama = String(data[i][3]);
      if (userRenameMap[nama]) u.getRange(i + 1, 4).setValue(userRenameMap[nama]);
    }
  }

  SpreadsheetApp.getActive().toast('Migrasi v4 selesai. SPPG dan user names sudah diupdate.', 'Migrasi v4', 8);
}

// ============================================================
//  INITIAL SETUP (jangan jalankan kalau sudah ada data)
// ============================================================

function setupSheets() {
  const ss = getSS();
  function ensureSheet(name, headers) {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    s.clear();
    s.getRange(1, 1, 1, headers.length).setValues([headers])
     .setFontWeight('bold').setBackground('#15663E').setFontColor('#ffffff');
    s.setFrozenRows(1);
    return s;
  }
  const u = ensureSheet(SHEETS.USERS, ['id','username','password','nama','role','dapur_id','aktif']);
  u.getRange(2,1,10,7).setValues([
    ['U001','admin','admin123','Super Admin','admin','','YA'],
    ['U002','yayasan','yayasan123','Yayasan ISS','yayasan','','YA'],
    ['U003','akuntan1','akun123','Akuntan Cipeujeuh 02','akuntan','D001','YA'],
    ['U004','akuntan2','akun123','Akuntan Mekarsari 01','akuntan','D002','YA'],
    ['U005','akuntan3','akun123','Akuntan Sukamukti 01','akuntan','D003','YA'],
    ['U006','akuntan4','akun123','Akuntan Cipaku 02','akuntan','D004','YA'],
    ['U007','pic1','pic123','PIC Cipeujeuh 02','pic','D001','YA'],
    ['U008','pic2','pic123','PIC Mekarsari 01','pic','D002','YA'],
    ['U009','pic3','pic123','PIC Sukamukti 01','pic','D003','YA'],
    ['U010','pic4','pic123','PIC Cipaku 02','pic','D004','YA'],
  ]);
  const d = ensureSheet(SHEETS.DAPUR, ['id','nama','alamat','kode','telepon','email']);
  d.getRange(2,1,4,4).setValues([
    ['D001','SPPG Cipeujeuh 02','','CPJ02'],['D002','SPPG Mekarsari 01','','MKS01'],
    ['D003','SPPG Sukamukti 01','','SKM01'],['D004','SPPG Cipaku 02','','CPK02'],
  ]);
  ensureSheet(SHEETS.SETUP, ['id','dapur_id','periode_no','tanggal_mulai','tanggal_akhir','penerima','saldo_va_awal','saldo_petty_awal','status','created_at','created_by','updated_at','updated_by']);
  ensureSheet(SHEETS.PETTY, ['id','dapur_id','periode_id','tanggal','jumlah','keterangan','created_at','created_by']);
  ensureSheet(SHEETS.VA, ['id','dapur_id','periode_id','tanggal','jumlah','keterangan','created_at','created_by']);
  ensureSheet(SHEETS.TRANSAKSI, ['id','dapur_id','tanggal','no_bukti','jenis','kategori','uraian','sumber','riil','unriil','bukti_url','created_at','created_by','periode_id','pengajuan_item_id']);
  ensureSheet(SHEETS.LOG, ['timestamp','user_id','action','reference']);
}


// ============================================================
//  v6 — BERITA ACARA PENGAJUAN ANGGARAN
//  1 Berita Acara per dapur per hari H. Menggabungkan SEMUA pengajuan hari itu
//  (dari akuntan maupun asisten) dan hanya memuat baris yang DISETUJUI / TEREALISASI.
//  Ditandatangani otomatis oleh akuntan dapur (gambar TTD diunggah sekali di Profil).
//  Tanda tangan disimpan di Drive pemilik script TANPA dibagikan; ID file di Script Properties.
// ============================================================

const NAMA_YAYASAN = 'Yayasan Insan Sinergi Cendikia';
const TTD_MAX_BYTES = 300 * 1024;

function ttdKey(userId) { return 'ttd_' + userId; }

// Batch & chunked cache untuk gambar tanda tangan (maks 5 × 90 KB = 450 KB base64, mencakup batas 300 KB penuh).
// Mengurangi 50-80 panggilan CacheService/DriveApp berurutan saat cetak kwitansi / unduh LPDH menjadi 1-2 panggilan batch.
const TTD_CACHE_CHUNK = 90000;
function ttdCacheGetAll(cache, keys) {
  if (!keys.length) return {};
  try { if (typeof cache.getAll === 'function') return cache.getAll(keys) || {}; } catch (e) {}
  const out = {};
  keys.forEach(function(k) { try { const v = cache.get(k); if (v !== null && v !== undefined) out[k] = v; } catch (e) {} });
  return out;
}
function ttdCachePutAll(cache, map) {
  const keys = Object.keys(map);
  if (!keys.length) return;
  try { if (typeof cache.putAll === 'function') { cache.putAll(map, 21600); return; } } catch (e) {}
  keys.forEach(function(k) { try { cache.put(k, map[k], 21600); } catch (e) {} });
}
function ttdStageCache(toPut, fid, url) {
  if (!fid || !url || url.length > TTD_CACHE_CHUNK * 5) return;
  const ck = 'ttdimg_' + fid;
  if (url.length <= TTD_CACHE_CHUNK) { toPut[ck] = url; return; }
  const n = Math.ceil(url.length / TTD_CACHE_CHUNK);
  toPut[ck] = '#CH:' + n;
  for (let i = 0; i < n; i++) toPut[ck + '_' + i] = url.substring(i * TTD_CACHE_CHUNK, (i + 1) * TTD_CACHE_CHUNK);
}
function readTtdBatch(userIds, props) {
  const out = {}, fidById = {}, uniqFids = [], seenFid = {};
  const src = props || PropertiesService.getScriptProperties().getProperties();
  (userIds || []).forEach(function(uid) {
    if (!uid) return;
    const fid = src[ttdKey(uid)];
    if (!fid) { out[uid] = null; return; }
    fidById[uid] = fid;
    if (!seenFid[fid]) { seenFid[fid] = 1; uniqFids.push(fid); }
  });
  if (!uniqFids.length) return out;
  const cache = CacheService.getScriptCache();
  const hit = ttdCacheGetAll(cache, uniqFids.map(function(f) { return 'ttdimg_' + f; }));
  const urlByFid = {}, chunkNeed = [], chunkKeys = [];
  uniqFids.forEach(function(fid) {
    const v = hit['ttdimg_' + fid];
    if (!v) return;
    if (v.indexOf('#CH:') === 0) {
      const n = Number(v.substring(4)) || 0;
      if (n > 0 && n <= 5) {
        chunkNeed.push({ fid: fid, n: n });
        for (let i = 0; i < n; i++) chunkKeys.push('ttdimg_' + fid + '_' + i);
      }
    } else urlByFid[fid] = v;
  });
  if (chunkKeys.length) {
    const chHit = ttdCacheGetAll(cache, chunkKeys);
    chunkNeed.forEach(function(item) {
      let ok = true, parts = [];
      for (let i = 0; i < item.n; i++) {
        const part = chHit['ttdimg_' + item.fid + '_' + i];
        if (!part) { ok = false; break; }
        parts.push(part);
      }
      if (ok) urlByFid[item.fid] = parts.join('');
    });
  }
  const toPut = {};
  uniqFids.forEach(function(fid) {
    if (fid in urlByFid) return;
    try {
      const blob = DriveApp.getFileById(fid).getBlob();
      const url = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
      urlByFid[fid] = url;
      ttdStageCache(toPut, fid, url);
    } catch (e) { urlByFid[fid] = null; }
  });
  ttdCachePutAll(cache, toPut);
  Object.keys(fidById).forEach(function(uid) { out[uid] = urlByFid[fidById[uid]] || null; });
  return out;
}

// props (opsional): hasil getProperties() sekali per permintaan agar tidak memanggil PropertiesService berulang.
// Gambar disimpan di cache 6 jam dengan kunci file id: TTD yang diganti otomatis memakai file baru (tidak basi).
function readTtdDataUrl(userId, props) {
  if (!userId) return null;
  const fid = props ? props[ttdKey(userId)] : PropertiesService.getScriptProperties().getProperty(ttdKey(userId));
  if (!fid) return null;
  const tmp = {}; tmp[ttdKey(userId)] = fid;
  return readTtdBatch([userId], tmp)[userId] || null;
}

// Pemilik tanda tangan: diri sendiri (akuntan/PIC), Kepala SPPG (diunggah PIC/admin), atau penerima insentif/relawan
function ttdSasaran(me, p) {
  const untuk = String(p.untuk || '');
  if (!untuk) {
    if (['akuntan', 'pic', 'aslap', 'admin'].indexOf(me.role) < 0) return { error: 'Peran Anda tidak menyimpan tanda tangan' };
    return { kunci: me.id };
  }
  if (untuk === 'kepala') {
    if (me.role !== 'pic' && me.role !== 'admin') return { error: 'Tanda tangan Kepala SPPG diunggah oleh PIC' };
    const d = me.role === 'admin' ? String(p.dapur || '') : me.dapur;
    if (!d) return { error: 'Pilih dapur' };
    return { kunci: 'KEPALA_' + d };
  }
  if (untuk === 'wakil') {   // Perwakilan Mitra/Yayasan (lembar pengesahan LPDH): per dapur, diunggah yayasan/admin/PIC dapur itu
    if (['yayasan', 'admin', 'pic'].indexOf(me.role) < 0) return { error: 'Tanda tangan Perwakilan Yayasan diunggah oleh Yayasan, admin, atau PIC' };
    const d = me.role === 'pic' ? me.dapur : String(p.dapur || '');
    if (!d || !getDapur().data.some(function(x) { return x.id === d; })) return { error: 'Pilih dapur' };
    return { kunci: 'WAKIL_' + d };
  }
  if (untuk === 'penerima') {
    const pn = cariDataPenerima(String(p.id || ''));
    if (!pn) return { error: 'Data penerima tidak ditemukan' };
    if (['akuntan', 'pic', 'admin'].indexOf(me.role) < 0 || (me.role !== 'admin' && pn.dapur !== me.dapur)) return { error: 'Bukan dapur Anda' };
    return { kunci: 'P_' + pn.id };
  }
  return { error: 'Sasaran tanda tangan tidak dikenal' };
}
function getTtd(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const s = p.untuk ? ttdSasaran(me, p) : { kunci: me.id };
  if (s.error) return { ok: false, error: s.error };
  return { ok: true, data: { ttd: readTtdDataUrl(s.kunci) } };
}

function saveTtd(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const sas = ttdSasaran(me, p);
  if (sas.error) return { ok: false, error: sas.error };
  const raw = String(p.fileData || '').replace(/^data:[^,]*,/, '');
  if (!raw) return { ok: false, error: 'Gambar tanda tangan kosong' };
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > TTD_MAX_BYTES) return { ok: false, error: 'Gambar tanda tangan terlalu besar (maks 300 KB)' };
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty(ttdKey(sas.kunci));
  // Disimpan di root Drive pemilik script (BUKAN folder bukti yang dibagikan publik) agar tidak ikut terbuka via link
  const file = DriveApp.createFile(Utilities.newBlob(bytes, 'image/png', 'TTD_' + sas.kunci + '_' + nowStamp() + '.png'));
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) {}
  props.setProperty(ttdKey(sas.kunci), file.getId());
  // Langsung isi cache agar cetak kwitansi pertama setelah simpan tidak perlu membaca ulang Drive
  const toPut = {}; ttdStageCache(toPut, file.getId(), 'data:image/png;base64,' + raw);
  ttdCachePutAll(CacheService.getScriptCache(), toPut);
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  logActivity(me.id, 'saveTtd', sas.kunci + ' ' + file.getId());
  return { ok: true };
}

function hapusTtd(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const sas = p.untuk ? ttdSasaran(me, p) : { kunci: me.id };
  if (sas.error) return { ok: false, error: sas.error };
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty(ttdKey(sas.kunci));
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} props.deleteProperty(ttdKey(sas.kunci)); }
  logActivity(me.id, 'hapusTtd', old || '');
  return { ok: true };
}

// ============================================================
//  DATA PENERIMA (relawan, PIC sekolah, kader posyandu) — dasar kwitansi harian, diisi sekali & dipakai berulang
//  Sheet DataPenerima: id | dapur_id | jenis | nama | jabatan | lembaga | pm | nominal | metode | aktif | updated_at | updated_by
//  Tanda tangan tiap penerima disimpan privat (Script Properties ttd_P_<id>), lihat saveTtd untuk:'penerima'
// ============================================================
const JENIS_PENERIMA = { RELAWAN: 'Relawan', PIC_SEKOLAH: 'PIC Sekolah', KADER: 'Kader Posyandu' };
function dataPenerimaSheet() { return sheetOtomatis('DataPenerima', ['id', 'dapur_id', 'jenis', 'nama', 'jabatan', 'lembaga', 'pm', 'nominal', 'metode', 'aktif', 'updated_at', 'updated_by']); }
function bacaDataPenerima(dapurId) {
  const d = dataPenerimaSheet().getDataRange().getValues(), out = [];
  for (let i = 1; i < d.length; i++) {
    if (!d[i][0] || (dapurId && d[i][1] !== dapurId)) continue;
    out.push({ _row: i + 1, id: String(d[i][0]), dapur: d[i][1], jenis: String(d[i][2]), nama: String(d[i][3] || ''), jabatan: String(d[i][4] || ''), lembaga: String(d[i][5] || ''),
      pm: Number(d[i][6]) || 0, nominal: Number(d[i][7]) || 0, metode: String(d[i][8] || 'Transfer'), aktif: String(d[i][9]).toUpperCase() !== 'TIDAK' });
  }
  return out;
}
// Impor sekali per dapur: relawan yang sudah tercatat sebelum ada Data Penerima (daftar tetap lama, atau semua pembayaran honor).
// Aktif = ada di daftar tetap (dicentang) / hadir di pembayaran honor terakhir. Upah = data terbaru orang itu.
function imporRelawanLama(dapurId, oleh) {
  const props = PropertiesService.getScriptProperties(), kunci = 'dp_impor_' + dapurId;
  if (props.getProperty(kunci)) return 0;
  if (bacaDataPenerima(dapurId).some(function(x) { return x.jenis === 'RELAWAN'; })) { props.setProperty(kunci, 'ada'); return 0; }
  const semua = bacaRelawanSemua(dapurId), orang = {}, urut = [];
  const tetap = semua[RELAWAN_TETAP + dapurId];
  if (tetap && tetap.rows.length) tetap.rows.forEach(function(r) { const k = String(r.nama || '').trim().toLowerCase(); if (!k || orang[k]) return; urut.push(k); orang[k] = { r: r, aktif: r.hadir !== false }; });
  else {
    const bayar = Object.keys(semua).filter(function(k) { return k.indexOf(RELAWAN_TETAP) !== 0; }).map(function(k) { return semua[k]; }).sort(function(a, b) { return a.seq - b.seq; });
    const akhir = bayar[bayar.length - 1];
    bayar.forEach(function(b) { b.rows.forEach(function(r) {
      const k = String(r.nama || '').trim().toLowerCase(); if (!k) return;
      if (!orang[k]) urut.push(k);
      const lama = orang[k];
      orang[k] = { r: Object.assign({}, r, { nama: lama ? lama.r.nama : r.nama, tugas: r.tugas || (lama && lama.r.tugas) || '', upah: Number(r.upah) > 0 ? r.upah : (lama && lama.r.upah) || 0 }),
        aktif: b === akhir && r.hadir !== false };
    }); });
  }
  const baris = urut.map(function(k) { return orang[k]; }).filter(function(o) { return Number(o.r.upah) > 0; }).map(function(o) {
    return [idUnik('DP'), dapurId, 'RELAWAN', String(o.r.nama).trim().substring(0, 80), String(o.r.tugas || '').trim().substring(0, 60), '', 0, Math.round(Number(o.r.upah)),
      o.r.metode === 'Tunai' ? 'Tunai' : 'Transfer', o.aktif ? 'YA' : 'TIDAK', new Date(), oleh]; });
  if (baris.length) { const sh = dataPenerimaSheet(); sh.getRange(sh.getLastRow() + 1, 1, baris.length, baris[0].length).setValues(baris); logActivity(oleh, 'imporRelawanLama', dapurId + ' (' + baris.length + ' orang)'); }
  props.setProperty(kunci, String(baris.length));
  return baris.length;
}
function cariDataPenerima(id) { return bacaDataPenerima('').find(function(x) { return x.id === id; }) || null; }
function adaTtd(kunci) { return !!PropertiesService.getScriptProperties().getProperty(ttdKey(kunci)); }
function getDataPenerima(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const diimpor = PropertiesService.getScriptProperties().getProperty('dp_impor_' + dapurId) ? 0 : withLock(function() { return imporRelawanLama(dapurId, me.id); });
  const props = PropertiesService.getScriptProperties().getProperties();
  return { ok: true, data: { diimpor: diimpor, rows: bacaDataPenerima(dapurId).map(function(x) { const o = Object.assign({}, x); delete o._row; o.ada_ttd = !!props[ttdKey('P_' + x.id)]; return o; }),
    bisaUbah: bisaIsiLPDH(me) } };
}
function bersihkanPenerima(x) {
  const jenis = String(x.jenis || '');
  if (!JENIS_PENERIMA[jenis]) return { error: 'Jenis penerima tidak dikenal' };
  const r = { jenis: jenis, nama: String(x.nama || '').trim().substring(0, 80), jabatan: String(x.jabatan || '').trim().substring(0, 60), lembaga: String(x.lembaga || '').trim().substring(0, 80),
    pm: Math.max(0, Math.round(Number(x.pm) || 0)), nominal: Math.round(Number(x.nominal) || 0), metode: x.metode === 'Tunai' ? 'Tunai' : 'Transfer', aktif: x.aktif !== false && x.aktif !== 'false' };
  if (!r.nama) return { error: 'Nama wajib diisi' };
  if (!(r.nominal > 0)) return { error: (jenis === 'RELAWAN' ? 'Upah per hari' : 'Nominal insentif') + ' wajib > 0' };
  if (jenis !== 'RELAWAN' && !r.lembaga) return { error: 'Nama ' + (jenis === 'KADER' ? 'posyandu' : 'sekolah') + ' wajib diisi' };
  return { row: r };
}
function saveDataPenerima(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const b = bersihkanPenerima(p);
  if (b.error) return { ok: false, error: b.error };
  return withLock(function() {
    const sh = dataPenerimaSheet(), semua = bacaDataPenerima(dapurId);
    const ada = p.id ? semua.find(function(x) { return x.id === String(p.id); }) : null;
    if (p.id && !ada) return { ok: false, error: 'Data penerima tidak ditemukan' };
    if (semua.some(function(x) { return x.jenis === b.row.jenis && x.nama.toLowerCase() === b.row.nama.toLowerCase() && (!ada || x.id !== ada.id); }))
      return { ok: false, error: 'Nama "' + b.row.nama + '" sudah ada di daftar ' + JENIS_PENERIMA[b.row.jenis] };
    const id = ada ? ada.id : idUnik('DP'), r = b.row;
    const baris = [id, dapurId, r.jenis, r.nama, r.jabatan, r.lembaga, r.pm, r.nominal, r.metode, r.aktif ? 'YA' : 'TIDAK', new Date(), me.id];
    if (ada) sh.getRange(ada._row, 1, 1, baris.length).setValues([baris]); else sh.appendRow(baris);
    logActivity(me.id, 'saveDataPenerima', id + ' ' + r.jenis + ' ' + r.nama);
    return { ok: true, data: { id: id } };
  });
}
function hapusDataPenerima(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  return withLock(function() {
    const pn = cariDataPenerima(String(p.id || ''));
    if (!pn) return { ok: false, error: 'Data penerima tidak ditemukan' };
    if (me.role !== 'admin' && pn.dapur !== me.dapur) return { ok: false, error: 'Bukan dapur Anda' };
    dataPenerimaSheet().deleteRow(pn._row);
    const props = PropertiesService.getScriptProperties(), fid = props.getProperty(ttdKey('P_' + pn.id));
    if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} props.deleteProperty(ttdKey('P_' + pn.id)); }
    logActivity(me.id, 'hapusDataPenerima', pn.id + ' ' + pn.nama);
    return { ok: true };
  });
}

// ============================================================
//  KWITANSI HARIAN — 1 orang 1 kwitansi per hari, dari Data Penerima
//  Relawan: "Tanda Terima Upah Relawan" (tanpa nomor). PIC Sekolah & Kader: BASTI bernomor urut per dapur per bulan
//  (NN/BASTI/SPPG-<kode dapur>/<bulan romawi>/<tahun>). Nomor yang sudah terbit tetap saat dicetak ulang.
//  KwitansiHarian: id | dapur_id | tanggal | penerima_id | jenis | nomor | seq | nama | jabatan | lembaga | pm | nominal | keterangan | updated_at | updated_by
// ============================================================
const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
function kwitansiSheet(tulis) {
  const sh = sheetOtomatis('KwitansiHarian', ['id', 'dapur_id', 'tanggal', 'penerima_id', 'jenis', 'nomor', 'seq', 'nama', 'jabatan', 'lembaga', 'pm', 'nominal', 'keterangan', 'updated_at', 'updated_by', 'pengganti', 'paraf_by']);
  if (tulis) { const h = sh.getDataRange().getValues()[0] || []; if (String(h[15] || '') === '') sh.getRange(1, 16, 1, 2).setValues([['pengganti', 'paraf_by']]); }
  return sh;
}
function tglTeks(v) { return v instanceof Date ? Utilities.formatDate(v, 'GMT+7', 'yyyy-MM-dd') : String(v || '').substring(0, 10); }
function bacaKwitansi(dapurId) {
  const d = kwitansiSheet().getDataRange().getValues(), out = [];
  for (let i = 1; i < d.length; i++) {
    if (!d[i][0] || d[i][1] !== dapurId) continue;
    out.push({ _row: i + 1, id: String(d[i][0]), tanggal: tglTeks(d[i][2]), penerima_id: String(d[i][3]), jenis: String(d[i][4]), nomor: String(d[i][5] || ''), seq: Number(d[i][6]) || 0,
      nama: String(d[i][7] || ''), jabatan: String(d[i][8] || ''), lembaga: String(d[i][9] || ''), pm: Number(d[i][10]) || 0, nominal: Number(d[i][11]) || 0, keterangan: String(d[i][12] || ''),
      pengganti: String(d[i][15] || ''), paraf_by: String(d[i][16] || '') });
  }
  return out;
}
// PDF kwitansi per jenis per hari (disimpan di folder bukti) — tautannya masuk ke LPDH
function kwitansiFileSheet(tulis) {
  const sh = sheetOtomatis('KwitansiFile', ['dapur_id', 'tanggal', 'jenis', 'url', 'file_id', 'updated_at', 'updated_by', 'sig']);
  if (tulis) { const h = sh.getDataRange().getValues()[0] || []; if (String(h[7] || '') === '') sh.getRange(1, 8).setValue('sig'); }
  return sh;
}
// Baca sekali per permintaan semua yang dibutuhkan pemeriksaan kwitansi (dulu dibaca berulang per jenis & per orang → lambat)
function konteksKw(dapurId, tanggal, txHari) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const users = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1);
  const aktif = function(role) { const u = users.find(function(x) { return String(x[4]).toLowerCase() === role && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; }); return u ? { id: u[0], nama: String(u[3] || '') } : null; };
  const ada = function(k) { return !!(k && props[ttdKey(k)]); };
  const akn = aktif('akuntan'), pic = aktif('pic'), aslap = aktif('aslap');
  const tx = txHari || readAllTransaksi([dapurId]).filter(function(t) { return t.tanggal === tanggal; });
  const fd = kwitansiFileSheet().getDataRange().getValues(), file = {};
  for (let i = 1; i < fd.length; i++) if (fd[i][0] === dapurId && tglTeks(fd[i][1]) === tanggal && /^https:\/\//.test(String(fd[i][3]))) file[String(fd[i][2])] = { url: String(fd[i][3]), sig: String(fd[i][7] || '') };
  return { dapurId: dapurId, tanggal: tanggal, props: props, ada: ada, akn: akn, pic: pic, aslap: aslap, ttdAkn: !!(akn && ada(akn.id)), ttdPic: !!(pic && ada(pic.id)), ttdAslap: !!(aslap && ada(aslap.id)), ttdKepala: ada('KEPALA_' + dapurId),
    kw: bacaKwitansi(dapurId).filter(function(x) { return x.tanggal === tanggal; }), ins: tx.filter(function(t) { return t.tanggal === tanggal && t.jenis === 'Fasilitas SPPG'; }), file: file };
}
const JENIS_KW_FILE = ['RELAWAN', 'PIC_SEKOLAH', 'KADER', 'INSENTIF'];
// Tanda isi kwitansi: berubah bila penerima, pengganti, nominal, tanda tangan, atau transaksi insentif berubah → PDF tertaut di LPDH dibuat ulang otomatis
function sigKwitansi(k, jenis) {
  let isi;
  if (jenis === 'INSENTIF') isi = k.ins.map(function(t) { return [t.id, nilaiLPDH(t), t.no_bukti].join('~'); }).concat(['A' + k.ttdAkn, 'P' + k.ttdPic]);
  else isi = k.kw.filter(function(x) { return x.jenis === jenis; })
    .map(function(x) {
      const ttdAda = x.pengganti ? k.ada(x.paraf_by || (k.aslap && k.aslap.id) || '') : k.ada('P_' + x.penerima_id);
      return [x.id, x.nominal, x.pm, x.nomor, x.pengganti || '', ttdAda].join('~');
    }).concat(['A' + k.ttdAkn, 'K' + k.ttdKepala, 'P' + k.ttdPic]);
  const t = isi.join('|'); let h1 = 2166136261, h2 = 5381;   // dua hash 32-bit (FNV-1a & djb2) cukup untuk mendeteksi perubahan isi
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
  return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
}
function adaIsiKwitansi(k, jenis) { return jenis === 'INSENTIF' ? k.ins.length > 0 : k.kw.some(function(x) { return x.jenis === jenis; }); }
// Jenis kwitansi yang punya isi tetapi PDF-nya belum ada / sudah usang → harus dibuat (ulang) agar link LPDH selalu ke kwitansi bertanda tangan
function kwitansiPerlu(k) {
  return JENIS_KW_FILE.filter(function(j) { return adaIsiKwitansi(k, j) && (!k.file[j] || k.file[j].sig !== sigKwitansi(k, j) || k.kw.some(function(x) { return x.jenis === j && !x.nomor; })); });
}
// Ringan: dipanggil saat tombol Unduh LPDH ditekan (bukan saat halaman dibuka)
// Tanda tangan tiga pihak lembar pengesahan LPDH: Pengawas Keuangan (akuntan), Kepala SPPG, Perwakilan Mitra/Yayasan
function getTtdPengesahan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const props = PropertiesService.getScriptProperties().getProperties();
  const akn = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1).find(function(x) { return String(x[4]).toLowerCase() === 'akuntan' && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; });
  const ids = ['KEPALA_' + dapurId, 'WAKIL_' + dapurId];
  if (akn) ids.push(akn[0]);
  const map = readTtdBatch(ids, props);
  return { ok: true, data: { pengawas: akn ? (map[akn[0]] || null) : null, kepala: map['KEPALA_' + dapurId] || null, wakil: map['WAKIL_' + dapurId] || null } };
}
function getKwitansiPerlu(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur), tanggal = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Pilih dapur & tanggal' };
  return { ok: true, data: { perlu: bisaIsiLPDH(me) ? kwitansiPerlu(konteksKw(dapurId, tanggal)) : [] } };
}
function linkKwitansiHari(dapurId, tanggal) {
  const d = kwitansiFileSheet().getDataRange().getValues(), out = {};
  for (let i = 1; i < d.length; i++) if (d[i][0] === dapurId && tglTeks(d[i][1]) === tanggal && /^https:\/\//.test(String(d[i][3]))) out[String(d[i][2])] = String(d[i][3]);
  return out;
}
function simpanKwitansiFile(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur), tanggal = String(p.tanggal || '').substring(0, 10), jenis = String(p.jenis || '');
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || JENIS_KW_FILE.indexOf(jenis) < 0) return { ok: false, error: 'Dapur, tanggal & jenis wajib' };
  const raw = String(p.fileData || '').replace(/^data:[^,]*,/, '');
  if (!raw) return { ok: false, error: 'File kwitansi kosong' };
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: 'File kwitansi terlalu besar' };
  // Unggah PDF ke Drive di luar withLock agar unggahan beberapa jenis kwitansi bisa berjalan serentak (paralel)
  const kode = (getDapur().data.find(function(x) { return x.id === dapurId; }) || {}).kode || dapurId;
  const file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(Utilities.newBlob(bytes, 'application/pdf', 'KWITANSI_' + jenis + '_' + kode + '_' + tanggal + '.pdf'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  try {
    return withLock(function() {
      const sh = kwitansiFileSheet(true), d = sh.getDataRange().getValues();
      // Hanya INSENTIF yang memakai sheet Transaksi dalam sigKwitansi → jenis lain lewati pembacaan Transaksi
      const k = konteksKw(dapurId, tanggal, jenis === 'INSENTIF' ? null : []);
      const baris = [dapurId, tanggal, jenis, file.getUrl(), file.getId(), new Date(), me.id, sigKwitansi(k, jenis)];
      let ada = 0;
      for (let i = 1; i < d.length; i++) if (d[i][0] === dapurId && tglTeks(d[i][1]) === tanggal && String(d[i][2]) === jenis) { ada = i + 1; break; }
      if (ada) { try { DriveApp.getFileById(String(d[ada - 1][4])).setTrashed(true); } catch (e) {} sh.getRange(ada, 1, 1, baris.length).setValues([baris]); } else sh.appendRow(baris);
      logActivity(me.id, 'simpanKwitansiFile', dapurId + ' ' + tanggal + ' ' + jenis);
      return { ok: true, data: { url: file.getUrl() } };
    });
  } catch (e) {
    try { file.setTrashed(true); } catch (e2) {}
    throw e;
  }
}
// Bahan untuk membuat ulang PDF kwitansi (dipakai LPDH): data yang SUDAH terbit + tanda tangan tersimpan. Tidak menomori ulang / mengubah apa pun.
function getKwitansiCetak(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaIsiLPDH(me)) return { ok: false, error: 'Hanya PIC, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur), tanggal = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Pilih dapur & tanggal' };
  let jenis = p.jenis; if (typeof jenis === 'string') jenis = jenis ? jenis.split(',') : null;
  const mau = function(j) { return !jenis || jenis.indexOf(j) >= 0; };   // hanya jenis yang perlu dibuat → gambar TTD yang lain tidak dibaca
  if (mau('RELAWAN')) lengkapiNomorRelawan(dapurId, tanggal);   // kwitansi relawan lama diberi nomor TTUR sebelum dicetak
  const urut = { RELAWAN: 0, PIC_SEKOLAH: 1, KADER: 2 };
  const k = konteksKw(dapurId, tanggal, mau('INSENTIF') ? null : []);
  const ident = readIdentitasLPDH(dapurId) || {};
  const kwPilih = k.kw.filter(function(x) { return mau(x.jenis); })
    .sort(function(a, b) { return (urut[a.jenis] - urut[b.jenis]) || (a.seq - b.seq) || a.nama.localeCompare(b.nama); });
  // Baca seluruh tanda tangan (penerima + paraf aslap untuk pengganti + akuntan + kepala + PIC) dalam satu batch cache
  const ttdIds = kwPilih.map(function(x) { return 'P_' + x.penerima_id; });
  kwPilih.forEach(function(x) { if (x.pengganti && x.paraf_by) ttdIds.push(x.paraf_by); });
  if (k.aslap) ttdIds.push(k.aslap.id);
  ttdIds.push('KEPALA_' + dapurId);
  if (k.akn) ttdIds.push(k.akn.id);
  if (k.pic) ttdIds.push(k.pic.id);
  const ttdMap = readTtdBatch(ttdIds, k.props);
  const rows = kwPilih.map(function(x) {
    const isSub = !!x.pengganti;
    const namaCetak = isSub ? (x.pengganti + ' (pengganti ' + x.nama + ')') : x.nama;
    const ttdPilih = isSub ? (ttdMap[x.paraf_by] || (k.aslap ? ttdMap[k.aslap.id] : null) || null) : (ttdMap['P_' + x.penerima_id] || null);
    return { penerima_id: x.penerima_id, jenis: x.jenis, nomor: x.nomor, nama: namaCetak, nama_asli: x.nama, pengganti: x.pengganti || '', paraf_aslap: isSub,
      jabatan: x.jabatan, lembaga: x.lembaga, pm: x.pm, nominal: x.nominal, keterangan: x.keterangan, ttd: ttdPilih };
  });
  const items = {}, heads = {};
  if (mau('INSENTIF') && k.ins.length) { readAllItems().forEach(function(i) { items[i.id] = i; }); readAllPengajuan().forEach(function(h) { heads[h.id] = h; }); }
  const insentif = (mau('INSENTIF') ? k.ins : []).map(function(t) {
    const it = items[String(t.pengajuan_item_id || '')] || {};
    return { id: t.id, tanggal: t.tanggal, no_bukti: String(t.no_bukti || ''), nominal: nilaiLPDH(t), uraian: String(t.uraian || ''), kategori: String(t.kategori || ''),
      penerima: it.penerima_nama || '', bank: it.bank || '', no_rek: it.no_rek || '', ref: it.pengajuan_id && heads[it.pengajuan_id] ? heads[it.pengajuan_id].nomor + ' #' + it.urut : '' };
  });
  return { ok: true, data: Object.assign(dataKwitansi(dapurId, tanggal, k, ident, ttdMap), { rows: rows, insentif: insentif,
    pengawas: { nama: ident.pengawas_nama || (k.akn && k.akn.nama) || '', ttd: k.akn ? (ttdMap[k.akn.id] || null) : null },
    pic: { nama: k.pic ? k.pic.nama : '', ttd: k.pic ? (ttdMap[k.pic.id] || null) : null }, perlu: kwitansiPerlu(k) }) };
}
// Nomor Tanda Terima Upah Relawan: urut per dapur per bulan, terpisah dari BASTI → NNN/TTUR/SPPG-<kode>/<bulan romawi>/<tahun>
function nomorRelawan(seq, kode, tanggal) {
  const b = Number(tanggal.substring(5, 7));
  return (seq < 1000 ? ('00' + seq).slice(-3) : String(seq)) + '/TTUR/SPPG-' + (kode || 'X') + '/' + ROMAWI[b - 1] + '/' + tanggal.substring(0, 4);
}
// Penghitung nomor (BASTI / TTUR) per dapur per bulan: tidak pernah mundur walau kwitansi dibuang
function nomorBerikut(semua, dapurId, bulan, relawan) {
  const props = PropertiesService.getScriptProperties(), kunci = (relawan ? 'kw_seq_rl_' : 'kw_seq_') + dapurId + '_' + bulan;
  let seq = Math.max(Number(props.getProperty(kunci)) || 0, semua.filter(function(k) { return (k.jenis === 'RELAWAN') === !!relawan && k.tanggal.substring(0, 7) === bulan; })
    .reduce(function(m, k) { return Math.max(m, k.seq); }, 0));
  return { ambil: function() { seq++; return seq; }, simpan: function() { props.setProperty(kunci, String(seq)); } };
}
// Kwitansi relawan yang terbit sebelum ada nomor → diberi nomor (urut nama), sekali saja
function lengkapiNomorRelawan(dapurId, tanggal) {
  const tanpa = bacaKwitansi(dapurId).filter(function(k) { return k.tanggal === tanggal && k.jenis === 'RELAWAN' && !k.nomor; });
  if (!tanpa.length) return 0;
  return withLock(function() {
    const semua = bacaKwitansi(dapurId), sisa = semua.filter(function(k) { return k.tanggal === tanggal && k.jenis === 'RELAWAN' && !k.nomor; })
      .sort(function(a, b) { return a.nama.localeCompare(b.nama); });
    if (!sisa.length) return 0;
    const kode = (getDapur().data.find(function(x) { return x.id === dapurId; }) || {}).kode || '';
    const no = nomorBerikut(semua, dapurId, tanggal.substring(0, 7), true), sh = kwitansiSheet();
    sisa.forEach(function(k) { const sq = no.ambil(); sh.getRange(k._row, 6, 1, 2).setValues([[nomorRelawan(sq, kode, tanggal), sq]]); });
    no.simpan();
    return sisa.length;
  });
}
function nomorBasti(seq, kode, tanggal) {
  const b = Number(tanggal.substring(5, 7));
  return ('0' + seq).slice(-2) + '/BASTI/SPPG-' + (kode || 'X') + '/' + ROMAWI[b - 1] + '/' + tanggal.substring(0, 4);
}
// relawan yang hadir menurut pembayaran honor tanggal itu (bila sudah diisi di LPDH) → dicentang otomatis
function relawanHadirTanggal(dapurId, tanggal, txHari) {
  const semua = bacaRelawanSemua(dapurId), nama = {};
  let ada = false;
  (txHari || readAllTransaksi([dapurId])).forEach(function(t) {
    if (t.tanggal !== tanggal || !isHonorRelawan(t) || !semua[t.id]) return;
    ada = true; semua[t.id].rows.forEach(function(r) { if (r.hadir !== false) nama[String(r.nama).toLowerCase()] = 1; });
  });
  return ada ? nama : null;
}
function dataKwitansi(dapurId, tanggal, k, identPre, ttdPre) {
  const dapurRow = getDapur().data.find(function(d) { return d.id === dapurId; }) || {};
  const ident = identPre || readIdentitasLPDH(dapurId) || {};
  let akn = k ? k.akn : null, props = k ? k.props : PropertiesService.getScriptProperties().getProperties();
  if (!k) { const u = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1).find(function(x) { return String(x[4]).toLowerCase() === 'akuntan' && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; });
    akn = u ? { id: u[0], nama: String(u[3] || '') } : null; }
  const ttd = ttdPre || readTtdBatch([akn ? akn.id : '', 'KEPALA_' + dapurId], props);
  return { tanggal: tanggal,
    dapur: { id: dapurId, nama: dapurRow.nama || dapurId, kode: dapurRow.kode || '', alamat: dapurRow.alamat || '', telepon: dapurRow.telepon || '', email: dapurRow.email || '' },
    logo: readLogoKop(),
    akuntan: { nama: akn ? akn.nama : '', ttd: akn ? (ttd[akn.id] || null) : null },
    kepala: { nama: ident.kepala_nama || '', nip: ident.kepala_nip || '', ttd: ttd['KEPALA_' + dapurId] || null } };
}
function anggaranKwitansiTanggal(dapurId, tanggal, txHari) {
  const tercatat = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
  const diajukan = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
  (txHari || []).forEach(function(t) {
    if (t.tanggal !== tanggal) return;
    if (isHonorRelawan(t)) tercatat.RELAWAN += nilaiLPDH(t);
    else if (t.jenis === 'Operasional' && t.kategori === 'Insentif Guru/PIC Sekolah') tercatat.PIC_SEKOLAH += nilaiLPDH(t);
    else if (t.jenis === 'Operasional' && t.kategori === 'Insentif Kader Posyandu') tercatat.KADER += nilaiLPDH(t);
  });
  const headIds = {};
  readAllPengajuan().forEach(function(h) { if (h.dapur === dapurId && h.tanggal === tanggal) headIds[h.id] = 1; });
  readAllItems().forEach(function(it) {
    if (!headIds[it.pengajuan_id] || ['MENUNGGU_ADMIN', 'DIAJUKAN', 'REVISI', 'DISETUJUI'].indexOf(it.status) < 0) return;
    if (it.jenis === 'Operasional' && /^gaji\/honor relawan/i.test(String(it.kategori || ''))) diajukan.RELAWAN += it.nominal;
    else if (it.jenis === 'Operasional' && it.kategori === 'Insentif Guru/PIC Sekolah') diajukan.PIC_SEKOLAH += it.nominal;
    else if (it.jenis === 'Operasional' && it.kategori === 'Insentif Kader Posyandu') diajukan.KADER += it.nominal;
  });
  return {
    tercatat: tercatat,
    diajukan: diajukan,
    anggaran: {
      RELAWAN: tercatat.RELAWAN + diajukan.RELAWAN,
      PIC_SEKOLAH: tercatat.PIC_SEKOLAH + diajukan.PIC_SEKOLAH,
      KADER: tercatat.KADER + diajukan.KADER,
    },
  };
}
function getKwitansiHarian(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur), tanggal = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Pilih dapur & tanggal' };
  if (!PropertiesService.getScriptProperties().getProperty('dp_impor_' + dapurId)) withLock(function() { return imporRelawanLama(dapurId, me.id); });
  const terbit = bacaKwitansi(dapurId).filter(function(k) { return k.tanggal === tanggal; }), byP = {};
  terbit.forEach(function(k) { byP[k.penerima_id] = k; });
  const txHari = readAllTransaksi([dapurId]).filter(function(t) { return t.tanggal === tanggal; });   // dibaca sekali, dipakai dua kali
  const hadir = relawanHadirTanggal(dapurId, tanggal, txHari);
  const props = PropertiesService.getScriptProperties().getProperties();
  const isAslap = me.role === 'aslap';
  const totalPilih = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
  const rows = bacaDataPenerima(dapurId).filter(function(x) { return x.aktif || byP[x.id]; }).map(function(x) {
    const k = byP[x.id];
    const nom = k ? k.nominal : x.nominal;
    const pilih = k ? true : terbit.length ? false : x.jenis === 'RELAWAN' && hadir ? !!hadir[x.nama.toLowerCase()] : true;
    if (pilih && totalPilih[x.jenis] !== undefined) totalPilih[x.jenis] += nom;
    return { penerima_id: x.id, jenis: x.jenis, nama: x.nama, jabatan: x.jabatan, lembaga: x.lembaga, ada_ttd: !!props[ttdKey('P_' + x.id)],
      pm: k ? k.pm : x.pm, nominal: isAslap ? null : nom, keterangan: k ? k.keterangan : '', nomor: k ? k.nomor : '', terbit: !!k,
      pengganti: k ? (k.pengganti || '') : '', pilih: pilih };
  });
  const ang = anggaranKwitansiTanggal(dapurId, tanggal, txHari);
  return { ok: true, data: { rows: rows, sudahTerbit: terbit.length, dariHonor: !!hadir, bisaUbah: bisaCatatLapangan(me),
    sembunyiNominal: isAslap, totalPilih: totalPilih, tercatat: ang.tercatat, diajukan: ang.diajukan, anggaran: ang.anggaran,
    adaParafAslap: !!props[ttdKey(me.id)], file: linkKwitansiHari(dapurId, tanggal) } };
}
function terbitkanKwitansi(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (!bisaCatatLapangan(me)) return { ok: false, error: 'Hanya PIC, aslap, akuntan, atau admin' };
  const dapurId = lpdhDapur(me, p.dapur), tanggal = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Pilih dapur & tanggal' };
  let a = p.rows; if (typeof a === 'string') a = bacaJson(a);
  if (!Array.isArray(a) || !a.length) return { ok: false, error: 'Pilih minimal satu penerima' };
  if (a.length > 300) return { ok: false, error: 'Maksimal 300 kwitansi per hari' };
  const isAslap = me.role === 'aslap';
  const simpanSaja = isAslap || p.simpan_saja === true || p.simpan_saja === 'true';
  const dp = {}; bacaDataPenerima(dapurId).forEach(function(x) { dp[x.id] = x; });
  const masuk = [], dipakai = {};
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || {}, pn = dp[String(x.penerima_id || '')];
    if (!pn) return { ok: false, error: 'Penerima tidak ditemukan di Data Penerima dapur ini' };
    if (dipakai[pn.id]) return { ok: false, error: pn.nama + ' tercantum dua kali — 1 orang 1 kwitansi per hari' };
    dipakai[pn.id] = 1;
    const nominal = isAslap ? Math.round(Number(pn.nominal) || 0) : Math.round(Number(x.nominal) || 0);
    if (!(nominal > 0)) return { ok: false, error: 'Nominal ' + pn.nama + ' wajib > 0' };
    const pengganti = String(x.pengganti || '').replace(/\s+/g, ' ').trim().substring(0, 80);
    masuk.push({ pn: pn, nominal: nominal, pm: Math.max(0, Math.round(Number(x.pm) || 0)), keterangan: String(x.keterangan || '').trim().substring(0, 120), pengganti: pengganti });
  }
  const propsTtd = PropertiesService.getScriptProperties().getProperties();
  const users = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1);
  const aknRow = users.find(function(x) { return String(x[4]).toLowerCase() === 'akuntan' && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; });
  const akn = aknRow ? { id: aknRow[0], nama: String(aknRow[3] || '') } : null;
  const aslapRow = users.find(function(x) { return String(x[4]).toLowerCase() === 'aslap' && x[5] === dapurId && String(x[6]).toUpperCase() === 'YA'; });
  const aslapId = aslapRow ? aslapRow[0] : '';
  const ttdIds = simpanSaja ? [] : masuk.map(function(m) { return 'P_' + m.pn.id; }).concat(['KEPALA_' + dapurId, akn ? akn.id : '', aslapId, me.id]);
  const ttdMap = simpanSaja ? {} : readTtdBatch(ttdIds, propsTtd);
  return withLock(function() {
    const sh = kwitansiSheet(true), semua = bacaKwitansi(dapurId), hariIni = semua.filter(function(k) { return k.tanggal === tanggal; });
    const kode = (getDapur().data.find(function(d) { return d.id === dapurId; }) || {}).kode || '';
    const bulan = tanggal.substring(0, 7);
    const noBasti = nomorBerikut(semua, dapurId, bulan, false), noRl = nomorBerikut(semua, dapurId, bulan, true);
    // urutan cetak: relawan, PIC sekolah, kader; dalam jenis menurut nama
    const urut = { RELAWAN: 0, PIC_SEKOLAH: 1, KADER: 2 };
    masuk.sort(function(x, y) { return (urut[x.pn.jenis] - urut[y.pn.jenis]) || x.pn.nama.localeCompare(y.pn.nama); });
    const now = new Date(), baruRows = [];
    const totalJenis = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
    const hasil = masuk.map(function(m) {
      const ada = hariIni.find(function(k) { return k.penerima_id === m.pn.id; });
      const nomFinal = isAslap && ada && ada.nominal > 0 ? ada.nominal : m.nominal;
      if (totalJenis[m.pn.jenis] !== undefined) totalJenis[m.pn.jenis] += nomFinal;
      let nomor = ada ? ada.nomor : '', sq = ada ? ada.seq : 0;
      if (!nomor) {   // baru, atau kwitansi relawan lama yang belum bernomor
        if (m.pn.jenis === 'RELAWAN') { sq = noRl.ambil(); nomor = nomorRelawan(sq, kode, tanggal); }
        else { sq = noBasti.ambil(); nomor = nomorBasti(sq, kode, tanggal); }
      }
      const parafBy = m.pengganti ? (isAslap ? me.id : ((ada && ada.paraf_by) || aslapId || me.id)) : '';
      const baris = [ada ? ada.id : idUnik('KW'), dapurId, tanggal, m.pn.id, m.pn.jenis, nomor, sq, m.pn.nama, m.pn.jabatan, m.pn.lembaga, m.pm, nomFinal, m.keterangan, now, me.id, m.pengganti, parafBy];
      if (ada) sh.getRange(ada._row, 1, 1, baris.length).setValues([baris]); else baruRows.push(baris);
      const isSub = !!m.pengganti;
      return { penerima_id: m.pn.id, jenis: m.pn.jenis, nomor: nomor, nama: isSub ? (m.pengganti + ' (pengganti ' + m.pn.nama + ')') : m.pn.nama,
        nama_asli: m.pn.nama, pengganti: m.pengganti, paraf_aslap: isSub, jabatan: m.pn.jabatan, lembaga: m.pn.lembaga, pm: m.pm,
        nominal: isAslap ? null : nomFinal, keterangan: m.keterangan,
        ttd: simpanSaja ? null : (isSub ? (ttdMap[parafBy] || (aslapId ? ttdMap[aslapId] : null) || null) : (ttdMap['P_' + m.pn.id] || null)) };
    });
    if (baruRows.length) sh.getRange(sh.getLastRow() + 1, 1, baruRows.length, baruRows[0].length).setValues(baruRows);
    noBasti.simpan(); noRl.simpan();
    // yang tidak dipilih lagi dibuang dari tanggal ini (nomornya tidak dipakai ulang agar arsip tidak bentrok)
    hariIni.filter(function(k) { return !dipakai[k.penerima_id]; }).sort(function(x, y) { return y._row - x._row; }).forEach(function(k) { sh.deleteRow(k._row); });
    logActivity(me.id, 'terbitkanKwitansi', dapurId + ' ' + tanggal + ' (' + hasil.length + (simpanSaja ? ', simpan saja' : '') + ')');
    if (simpanSaja) {
      const txHari = readAllTransaksi([dapurId]).filter(function(t) { return t.tanggal === tanggal; });
      const ang = anggaranKwitansiTanggal(dapurId, tanggal, txHari);
      return { ok: true, data: { sudahTerbit: hasil.length, totalPilih: totalJenis, tercatat: ang.tercatat, diajukan: ang.diajukan, anggaran: ang.anggaran } };
    }
    return { ok: true, data: Object.assign(dataKwitansi(dapurId, tanggal, { akn: akn, props: propsTtd }, null, ttdMap), { rows: hasil }) };
  });
}

// ============================================================
//  TUGAS HARIAN PIC — ringkasan pekerjaan hari itu (persetujuan, porsi PM, relawan hadir, kwitansi, tanda tangan, LPDH)
// ============================================================
function getTugasHarian(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = lpdhDapur(me, p.dapur), tgl = String(p.tanggal || todayStr()).substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return { ok: false, error: 'Pilih dapur & tanggal' };
  // persetujuan yang menunggu (semua tanggal) di dapur ini
  const menunggu = readAllItems().filter(function(i) { return i.dapur === dapurId && i.status === 'DIAJUKAN'; });
  const heads = {}; readAllPengajuan().forEach(function(h) { heads[h.id] = h; });
  const tglMenunggu = {}; menunggu.forEach(function(i) { const h = heads[i.pengajuan_id]; if (h) tglMenunggu[h.tanggal] = 1; });
  // porsi PM & syarat insentif hari itu
  const hr = bacaHarian(dapurId, tgl).tepat, hd = hr ? hr.data || {} : null;
  const porsi = hd ? (hd.pm || []).reduce(function(a, x) { return a + (Number(x.distribusi) || 0); }, 0) : 0;
  // penerima aktif & kwitansi terbit hari itu
  const tx = readAllTransaksi([dapurId]).filter(function(t) { return t.tanggal === tgl; });
  const k = konteksKw(dapurId, tgl, tx), dp = bacaDataPenerima(dapurId), props = k.props;
  const aktif = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 }, tanpaTtd = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
  dp.forEach(function(x) { if (!x.aktif || aktif[x.jenis] === undefined) return; aktif[x.jenis]++; if (!props[ttdKey('P_' + x.id)]) tanpaTtd[x.jenis]++; });
  const terbit = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 }, nilai = { RELAWAN: 0, PIC_SEKOLAH: 0, KADER: 0 };
  k.kw.forEach(function(x) { if (terbit[x.jenis] !== undefined) { terbit[x.jenis]++; nilai[x.jenis] += x.nominal; } });
  const honor = tx.filter(isHonorRelawan).reduce(function(a, t) { return a + nilaiLPDH(t); }, 0);
  return { ok: true, data: { tanggal: tgl,
    persetujuan: { baris: menunggu.length, nominal: menunggu.reduce(function(a, i) { return a + i.nominal + (i.biaya_admin || 0); }, 0), tanggal: Object.keys(tglMenunggu).sort() },
    porsi: { ada: !!hd, sekolah: hd && hd.sekolah ? hd.sekolah.length : 0, total: porsi, syarat: !!(hd && hd.syarat && LPDH_SYARAT.every(function(s2) { return hd.syarat[s2]; })) },
    penerima: { aktif: aktif, tanpaTtd: tanpaTtd }, kwitansi: { terbit: terbit, nilai: nilai, honor: honor },
    ttd: { kepala: k.ttdKepala, pic: k.ttdPic, akuntan: k.ttdAkn, namaKepala: (readIdentitasLPDH(dapurId) || {}).kepala_nama || '' },
    lpdh: { transaksi: tx.length, kwitansiPerlu: bisaIsiLPDH(me) ? kwitansiPerlu(k) : [] },
    bisaSetuju: me.role === 'pic' || me.role === 'admin' } };
}

// ============================================================
//  REALISASI MASSAL (admin) — baris pengajuan DISETUJUI (tunggakan lama) → transaksi
//  Dua mode: (1) tanpa_mutasi=true untuk merealisasikan langsung seluruh tunggakan lama (bisa satu dapur atau 'ALL' semua dapur);
//  (2) cocokkan mutasi rekening PDF BNI (per dapur). Selalu simulasi dulu; eksekusi butuh jumlah baris sama dengan simulasi.
//  Aman diulang: baris yang sudah punya transaksi tertaut tidak dibuat dua kali.
// ============================================================
function rencanaRealisasiMassal(dapurId, sertakanTutup, mutasi, catatAdmin) {
  const semuaDapur = getDapur().data || [];
  const dapurMap = {}; semuaDapur.forEach(function(x) { dapurMap[x.id] = x; });
  const dapurIds = dapurId === 'ALL' ? semuaDapur.map(function(x) { return x.id; }) : [dapurId];
  const items = readAllItems().filter(function(i) { return (dapurId === 'ALL' || i.dapur === dapurId) && i.status === 'DISETUJUI' && !i.transaksi_id; });
  const heads = {}; readAllPengajuan().forEach(function(h) { heads[h.id] = h; });
  const periode = {}; dapurIds.forEach(function(did) { readAllPeriode(did).forEach(function(r) { periode[r.id] = r; }); });
  const txAda = readAllTransaksi(dapurIds);
  const sudahTertaut = {}; txAda.forEach(function(t) { if (t.pengajuan_item_id) sudahTertaut[t.pengajuan_item_id] = t.id; });
  const tampil = getSheet(SHEETS.TRANSAKSI).getRange(1, 4, Math.max(getSheet(SHEETS.TRANSAKSI).getLastRow(), 1), 1).getDisplayValues();
  const dipakai = {}; for (let i = 1; i < tampil.length; i++) if (tampil[i][0]) dipakai[normNB(tampil[i][0])] = 1;
  const bankVAMap = {}; dapurIds.forEach(function(did) { bankVAMap[did] = String((readIdentitasLPDH(did) || {}).bank || ''); });
  const perNo = {};
  const siap = [], lewat = [], perbaiki = [];
  items.sort(function(a, b) {
    const ha = heads[a.pengajuan_id] || {}, hb = heads[b.pengajuan_id] || {};
    return String(a.dapur).localeCompare(String(b.dapur)) || String(ha.tanggal).localeCompare(String(hb.tanggal)) || (ha.seq - hb.seq) || (a.urut - b.urut);
  });
  items.forEach(function(it) {
    const h = heads[it.pengajuan_id], per = periode[it.periode_id];
    const tolak = function(alasan) { lewat.push({ id: it.id, dapur: it.dapur, dapur_nama: (dapurMap[it.dapur] && dapurMap[it.dapur].nama) || it.dapur, uraian: it.uraian, nominal: it.nominal, alasan: alasan }); };
    if (sudahTertaut[it.id]) { perbaiki.push({ it: it, txId: sudahTertaut[it.id] }); return; }
    if (!h || !/^\d{4}-\d{2}-\d{2}$/.test(h.tanggal)) return tolak('tanggal pengajuan tidak ada');
    if (!per) return tolak('periode tidak ditemukan');
    if (h.tanggal < per.tanggal_mulai || h.tanggal > per.tanggal_akhir) return tolak('tanggal pengajuan ' + h.tanggal + ' di luar periode ' + per.periode_no);
    if (!(it.nominal > 0)) return tolak('nominal bukan angka positif');
    if (per.status !== 'AKTIF' && !sertakanTutup) return tolak('periode ' + per.periode_no + ' sudah ditutup (centang "sertakan periode ditutup")');
    // nomor bukti: nomor nota bila ada & belum dipakai; selain itu nomor otomatis <kode>-<yyyymmdd>-<nnn>
    const kode = (dapurMap[it.dapur] && dapurMap[it.dapur].kode) || it.dapur;
    let nb = '';
    if (it.nota_no && !(normNB(it.nota_no) in dipakai) && !/^[\s\-–—_.\/]*$/.test(it.nota_no)) nb = it.nota_no;
    if (!nb) { const aw = kode + '-' + h.tanggal.replace(/-/g, '') + '-'; let n = perNo[aw] || 0; do { n++; nb = aw + String(n).padStart(3, '0'); } while (normNB(nb) in dipakai); perNo[aw] = n; }
    dipakai[normNB(nb)] = 1;
    const riil = butuhRencanaRealisasi(it.jenis, it.kategori) ? (it.rencana_riil > 0 ? it.rencana_riil : it.nominal) : it.nominal;
    const bankVA = bankVAMap[it.dapur] || '';
    const fee = it.biaya_admin > 0 ? it.biaya_admin : (catatAdmin === false ? 0 : feeTransfer(it.bank, bankVA));
    siap.push({ it: it, dapur: it.dapur, tanggal: h.tanggal, no_bukti: nb, periode: per, riil: riil, bukti: it.nota_url ? it.nota_url : '', fee: fee });
  });
  const hasil = { siap: siap, lewat: lewat, perbaiki: perbaiki, periode: periode, txAda: txAda };
  return mutasi ? cocokkanMutasi(hasil, dapurId, mutasi, heads) : hasil;
}
// ── Pencocokan dengan mutasi rekening (PDF BNI dibaca di aplikasi): hanya pengajuan yang benar-benar ada transfernya yang direalisasi ──
// Kunci: nominal sama persis + rekening tujuan + tanggal bank paling dekat dengan tanggal pengajuan (maks. 5 hari). Biaya admin = potongan nyata di mutasi.
function normRek(v) { return String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, ''); }
function selisihHari(a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5); }
function cocokkanMutasi(h, dapurId, mutasi, heads) {
  const deb = (mutasi.debit || []).map(function(d, i) { return { i: i, tgl: String(d.tgl || '').substring(0, 10), nom: Math.round(Number(d.nom) || 0), rek: normRek(d.rek), fee: Math.round(Number(d.fee) || 0),
    ref: String(d.ref || '').substring(0, 30), ket: String(d.ket || '').substring(0, 120), pakai: null }; }).filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.tgl) && d.nom > 0; });
  const tgls = deb.map(function(d) { return d.tgl; }).sort(), dari = tgls[0] || '', sampai = tgls[tgls.length - 1] || '';
  const dalam = function(t) { return dari && selisihHari(t, dari) >= -5 && selisihHari(t, sampai) <= 5; };
  const pilih = function(nom, rek, tgl) {
    const c = deb.filter(function(d) { return d.pakai === null && d.nom === nom && Math.abs(selisihHari(d.tgl, tgl)) <= 5; });
    c.sort(function(a, b) { return ((a.rek && a.rek === rek) ? 0 : 1) - ((b.rek && b.rek === rek) ? 0 : 1) || Math.abs(selisihHari(a.tgl, tgl)) - Math.abs(selisihHari(b.tgl, tgl)); });
    return c[0] || null;
  };
  // 1) transfer yang sudah tercatat di aplikasi memakai baris mutasinya lebih dulu (agar tidak dipasangkan dua kali)
  const items = {}; readAllItems().forEach(function(i) { items[i.id] = i; });
  h.txAda.filter(function(t) { return t.sumber !== 'Petty Cash' && !isFeeLink(t.pengajuan_item_id) && dalam(t.tanggal); })
    .sort(function(a, b) { return a.tanggal.localeCompare(b.tanggal); }).forEach(function(t) {
      const it = items[String(t.pengajuan_item_id || '')], d = pilih(Math.round(t.riil), it ? normRek(it.no_rek) : '', t.tanggal);
      if (d) d.pakai = 'TX:' + t.id;
    });
  // 2) pengajuan yang belum direalisasi
  const cocok = [], tanpa = [], beda = [], luar = [];
  h.siap.forEach(function(x) {
    const rek = normRek(x.it.no_rek), ringkas = { id: x.it.id, tanggal: x.tanggal, uraian: x.it.uraian, nominal: x.it.nominal, penerima: x.it.penerima_nama, bank: x.it.bank, rek: x.it.no_rek };
    if (!dalam(x.tanggal)) { luar.push(ringkas); return; }
    const d = pilih(x.it.nominal, rek, x.tanggal);
    if (!d) { tanpa.push(ringkas); return; }
    if (d.rek && rek && d.rek !== rek) { beda.push(Object.assign(ringkas, { rekMutasi: d.rek, tglMutasi: d.tgl, ket: d.ket })); return; }
    d.pakai = x.it.id;
    cocok.push(Object.assign({}, x, { fee: d.fee, mutasi: { tgl: d.tgl, ref: d.ref, fee: d.fee } }));
  });
  const sisa = deb.filter(function(d) { return d.pakai === null; });
  return Object.assign({}, h, { siap: cocok, mutasi: { dari: dari, sampai: sampai, debit: deb.length, tanpaMutasi: tanpa, rekBeda: beda, diluarMutasi: luar,
    sisaDebit: sisa.map(function(d) { return { tgl: d.tgl, nom: d.nom, rek: d.rek, fee: d.fee, ket: d.ket }; }), sisaNominal: sisa.reduce(function(a, d) { return a + d.nom + d.fee; }, 0),
    saldoAkhirBank: Math.round(Number(mutasi.saldoAkhir) || 0), saldoAwalBank: Math.round(Number(mutasi.saldoAwal) || 0) } });
}
function bacaMutasiParam(v) {
  if (!v) return null;
  const m = typeof v === 'string' ? bacaJson(v) : v;
  if (!m || !Array.isArray(m.debit)) return null;
  if (m.debit.length > 3000) return null;
  return m;
}
function ringkasMutasiHasil(m) {
  const pot = function(a) { return a.slice(0, 60); }, jml = function(a) { return a.reduce(function(s, x) { return s + (x.nominal || 0); }, 0); };
  return { dari: m.dari, sampai: m.sampai, debit: m.debit, tanpaMutasi: pot(m.tanpaMutasi), nTanpaMutasi: m.tanpaMutasi.length, nilaiTanpaMutasi: jml(m.tanpaMutasi),
    rekBeda: pot(m.rekBeda), nRekBeda: m.rekBeda.length, diluarMutasi: m.diluarMutasi.length, nilaiDiluar: jml(m.diluarMutasi),
    sisaDebit: pot(m.sisaDebit), nSisaDebit: m.sisaDebit.length, sisaNominal: m.sisaNominal, saldoAkhirBank: m.saldoAkhirBank };
}
// Saldo VA menurut aplikasi pada tanggal terakhir mutasi (setelah realisasi) dibandingkan saldo akhir di mutasi
function cekSaldoMutasi(dapurId, r) {
  const t = r.mutasi.sampai; if (!t) return null;
  const per = Object.keys(r.periode).map(function(k) { return r.periode[k]; }).find(function(x) { return t >= x.tanggal_mulai && t <= x.tanggal_akhir; });
  if (!per) return null;
  const tu = readVATopups(dapurId, per.id).filter(function(x) { return x.tanggal <= t; }).reduce(function(a, x) { return a + x.jumlah; }, 0);
  const lama = r.txAda.filter(function(x) { return x.periode_id === per.id && x.tanggal <= t; }).reduce(function(a, x) { return a + nilaiLPDH(x); }, 0);
  const baru = r.siap.filter(function(x) { return x.periode.id === per.id && x.tanggal <= t; }).reduce(function(a, x) { return a + x.it.nominal + (x.fee || 0); }, 0);
  const app = per.saldoVA + per.saldoPettyAwal + tu - lama - baru;
  return { tanggal: t, periode_no: per.periode_no, aplikasi: app, bank: r.mutasi.saldoAkhirBank, selisih: app - r.mutasi.saldoAkhirBank };
}
function bankVAdapur(dapurId) { return String((readIdentitasLPDH(dapurId) || {}).bank || ''); }
function realisasiMassal(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'admin' || me.sebagai) return { ok: false, error: 'Hanya admin' };
  const dapurId = String(p.dapur || '');
  const semuaDapur = getDapur().data || [];
  const dapurMap = {}; semuaDapur.forEach(function(x) { dapurMap[x.id] = x; });
  if (!dapurId || (dapurId !== 'ALL' && !dapurMap[dapurId])) return { ok: false, error: 'Pilih dapur' };
  const sertakanTutup = p.sertakan_tutup === true || p.sertakan_tutup === 'true';
  const eksekusi = p.eksekusi === true || p.eksekusi === 'true';
  const tanpaMutasi = p.tanpa_mutasi === true || p.tanpa_mutasi === 'true';
  const catatAdmin = !(p.catat_admin === false || p.catat_admin === 'false');
  const mutasi = tanpaMutasi ? null : bacaMutasiParam(p.mutasi);
  if (!mutasi && !tanpaMutasi) return { ok: false, error: 'Unggah mutasi rekening dulu — realisasi massal hanya untuk pengajuan yang transfernya ada di mutasi' };
  if (dapurId === 'ALL' && !tanpaMutasi) return { ok: false, error: 'Pilih satu dapur untuk pencocokan mutasi rekening' };
  const hitung = function() {
    const r = rencanaRealisasiMassal(dapurId, sertakanTutup, mutasi, catatAdmin), ringkas = {};
    r.siap.forEach(function(x) {
      const k = x.periode.id, dn = (dapurMap[x.dapur] && dapurMap[x.dapur].nama) || x.dapur;
      const o = ringkas[k] = ringkas[k] || { dapur_id: x.dapur, dapur_nama: dn, periode_no: x.periode.periode_no, status: x.periode.status, baris: 0, nominal: 0, jenis: {}, dari: x.tanggal, sampai: x.tanggal };
      o.baris++; o.nominal += x.it.nominal; o.admin = (o.admin || 0) + x.fee; o.nAdmin = (o.nAdmin || 0) + (x.fee > 0 ? 1 : 0); o.jenis[x.it.jenis] = (o.jenis[x.it.jenis] || 0) + x.it.nominal; if (x.tanggal < o.dari) o.dari = x.tanggal; if (x.tanggal > o.sampai) o.sampai = x.tanggal;
    });
    const topupCache = {};
    const topupDapur = function(did) { if (!topupCache[did]) topupCache[did] = readVATopups(did); return topupCache[did]; };
    const saldo = Object.keys(ringkas).map(function(k) {
      const per = r.periode[k], dn = (dapurMap[per.dapur] && dapurMap[per.dapur].nama) || per.dapur;
      const awal = per.saldoVA + per.saldoPettyAwal + topupDapur(per.dapur).filter(function(t) { return t.periode_id === k; }).reduce(function(a, t) { return a + t.jumlah; }, 0);
      const pakai = r.txAda.filter(function(t) { return t.periode_id === k; }).reduce(function(a, t) { return a + nilaiLPDH(t); }, 0);
      return { dapur_id: per.dapur, dapur_nama: dn, periode_no: per.periode_no, saldo_sekarang: awal - pakai, saldo_sesudah: awal - pakai - ringkas[k].nominal - (ringkas[k].admin || 0) };
    });
    const urut = function(a, b) { return String(a.dapur_nama).localeCompare(String(b.dapur_nama)) || (a.periode_no - b.periode_no); };
    return { r: r, ringkas: Object.keys(ringkas).map(function(k) { return ringkas[k]; }).sort(urut), saldo: saldo.sort(urut) };
  };
  if (!eksekusi) {
    const h = hitung();
    return { ok: true, data: { simulasi: true, tanpaMutasi: tanpaMutasi, jumlah: h.r.siap.length, nominal: h.r.siap.reduce(function(a, x) { return a + x.it.nominal; }, 0), perPeriode: h.ringkas, saldo: h.saldo,
      bankVA: dapurId === 'ALL' ? '' : bankVAdapur(dapurId), admin: h.r.siap.reduce(function(a, x) { return a + x.fee; }, 0), nAdmin: h.r.siap.filter(function(x) { return x.fee > 0; }).length,
      sudahTertaut: h.r.perbaiki.length, dilewati: h.r.lewat.length, alasanLewat: h.r.lewat.slice(0, 40),
      mutasi: h.r.mutasi ? ringkasMutasiHasil(h.r.mutasi) : null, cekSaldo: h.r.mutasi ? cekSaldoMutasi(dapurId, h.r) : null,
      contoh: h.r.siap.slice(0, 5).map(function(x) { return { dapur_nama: (dapurMap[x.dapur] && dapurMap[x.dapur].nama) || x.dapur, tanggal: x.tanggal, no_bukti: x.no_bukti, jenis: x.it.jenis, kategori: x.it.kategori, uraian: x.it.uraian, nominal: x.it.nominal, riil: x.riil, fee: x.fee }; }) } };
  }
  return withLock(function() {
    const h = hitung();
    if (Number(p.jumlah_konfirmasi) !== h.r.siap.length) return { ok: false, error: 'Jumlah konfirmasi (' + p.jumlah_konfirmasi + ') tidak sama dengan hasil simulasi sekarang (' + h.r.siap.length + '). Jalankan simulasi lagi.' };
    const trx = getSheet(SHEETS.TRANSAKSI), pit = getSheet(SHEETS.PITEM), now = new Date();
    const baris = [], idTx = {};
    let admin = 0;
    h.r.siap.forEach(function(x) {
      const txId = idUnik('TX'); idTx[x.it.id] = txId;
      baris.push([txId, x.dapur, x.tanggal, teksSel(x.no_bukti), x.it.jenis, x.it.kategori, x.it.uraian, 'VA', x.riil, x.it.nominal, x.bukti, now, me.id, x.it.periode_id, x.it.id]);
      if (x.fee > 0) { const f = feeRowFor(x.it, txId, x.tanggal, x.no_bukti, x.bukti, x.fee, me.id); f[3] = teksSel(f[3]); f[11] = now; baris.push(f); admin += x.fee; }   // biaya admin antarbank = transaksi terpisah
    });
    if (baris.length) trx.getRange(trx.getLastRow() + 1, 1, baris.length, 15).setValues(baris);
    h.r.perbaiki.forEach(function(x) { idTx[x.it.id] = x.txId; });
    // status baris pengajuan: kolom 15 (status), 20 (transaksi_id), 22 (updated_at) ditulis per kolom, sekali jalan
    const dat = pit.getDataRange().getValues(), n = dat.length - 1;
    if (n > 0) {
      const st = [], tc = [], up = [];
      for (let i = 1; i <= n; i++) { const t = idTx[dat[i][0]]; st.push([t ? 'TEREALISASI' : dat[i][14]]); tc.push([t || dat[i][19]]); up.push([t ? now : dat[i][21]]); }
      pit.getRange(2, 15, n, 1).setValues(st); pit.getRange(2, 20, n, 1).setValues(tc); pit.getRange(2, 22, n, 1).setValues(up);
    }
    const nUtama = h.r.siap.length, nominal = h.r.siap.reduce(function(a, x) { return a + x.it.nominal; }, 0);
    logActivity(me.id, 'realisasiMassal', dapurId + (tanpaMutasi ? ' (langsung)' : '') + ' ' + nUtama + ' baris Rp ' + nominal + ' + admin Rp ' + admin + (h.r.perbaiki.length ? ' (+' + h.r.perbaiki.length + ' ditautkan ulang)' : ''));
    return { ok: true, data: { simulasi: false, tanpaMutasi: tanpaMutasi, dibuat: nUtama, nominal: nominal, admin: admin, nAdmin: baris.length - nUtama, ditautkanUlang: h.r.perbaiki.length, perPeriode: h.ringkas, saldo: h.saldo, cekSaldo: h.r.mutasi ? cekSaldoMutasi(dapurId, h.r) : null } };
  });
}

// Logo kop Berita Acara (logo BGN), diunggah admin sekali, dipakai semua SPPG
const LOGO_KEY = 'logo_kop';
function readLogoKop() {
  const fid = PropertiesService.getScriptProperties().getProperty(LOGO_KEY);
  if (!fid) return null;
  const cache = CacheService.getScriptCache(), ck = 'logoimg_' + fid;
  try { const c = cache.get(ck); if (c) return c; } catch (e) {}
  try { const b = DriveApp.getFileById(fid).getBlob(); const url = 'data:' + (b.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(b.getBytes());
    if (url.length < 95000) { try { cache.put(ck, url, 21600); } catch (e) {} } return url; }
  catch (e) { return null; }
}
function getLogoKop(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  return { ok: true, data: { logo: readLogoKop() } };
}
function saveLogoKop(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'admin') return { ok: false, error: 'Hanya admin yang mengatur logo kop' };
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty(LOGO_KEY);
  if (p.hapus) {
    if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} props.deleteProperty(LOGO_KEY); }
    logActivity(me.id, 'hapusLogoKop', old || '');
    return { ok: true };
  }
  const raw = String(p.fileData || '').replace(/^data:[^,]*,/, '');
  if (!raw) return { ok: false, error: 'Gambar logo kosong' };
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > TTD_MAX_BYTES) return { ok: false, error: 'Logo terlalu besar (maks 300 KB)' };
  const file = DriveApp.createFile(Utilities.newBlob(bytes, 'image/png', 'LOGO_KOP_' + nowStamp() + '.png'));
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) {}
  props.setProperty(LOGO_KEY, file.getId());
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  logActivity(me.id, 'saveLogoKop', file.getId());
  return { ok: true };
}

function baCanAccess(me, dapurId) {
  if (me.role === 'akuntan' || me.role === 'pic') return me.dapur === dapurId;
  return me.role === 'admin' || me.role === 'yayasan' || me.role === 'asisten';   // asisten mengajukan untuk semua dapur
}

// Status siap cetak per dapur per hari (untuk tombol di daftar pengajuan & halaman Berita Acara)
// mode: 'hari' (hari H = p.tanggal, default hari ini) | 'aktif' (periode aktif) | 'periode' (p.periode_id) | kosong = semua (kompatibel versi lama)
// p.scope: batasi ke satu dapur (admin/yayasan/asisten)
function getBADaftar(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const mode = String(p.mode || '');
  if (mode === 'periode' && !p.periode_id) return { ok: false, error: 'Pilih periode' };
  const perMap = {};
  readAllPeriode().forEach(r => { perMap[r.id] = r; });
  let heads = readAllPengajuan().filter(h => baCanAccess(me, h.dapur));
  if (p.periode_id) heads = heads.filter(h => h.periode_id === p.periode_id);
  if (p.scope && p.scope !== 'ALL') heads = heads.filter(h => h.dapur === p.scope);
  if (mode === 'hari') {
    const tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(p.tanggal || '')) ? String(p.tanggal) : todayStr();
    heads = heads.filter(h => h.tanggal === tgl);
  } else if (mode === 'aktif') {
    heads = heads.filter(h => (perMap[h.periode_id] || {}).status === 'AKTIF');
  }
  // Kelompokkan baris sekali saja (sebelumnya: filter seluruh baris untuk setiap pengajuan)
  const want = {};
  heads.forEach(h => { want[h.id] = true; });
  const itemsBy = {};
  if (heads.length) readAllItems().forEach(i => { if (want[i.pengajuan_id]) (itemsBy[i.pengajuan_id] = itemsBy[i.pengajuan_id] || []).push(i); });
  const groups = {};
  heads.forEach(function(h) {
    const k = h.dapur + '|' + h.tanggal;
    const per = perMap[h.periode_id] || {};
    if (!groups[k]) groups[k] = { dapur: h.dapur, tanggal: h.tanggal, nomor: h.nomor, periode_id: h.periode_id,
      periode_no: per.periode_no || '', periode_status: per.status || '', periode_mulai: per.tanggal_mulai || '', periode_akhir: per.tanggal_akhir || '',
      pengajuan: 0, menunggu: 0, disetujui: 0, total: 0 };
    const g = groups[k]; g.pengajuan++;
    (itemsBy[h.id] || []).forEach(function(i) {
      if (i.status === 'MENUNGGU_ADMIN' || i.status === 'DIAJUKAN' || i.status === 'REVISI') g.menunggu++;
      if (i.status === 'DISETUJUI' || i.status === 'TEREALISASI') { g.disetujui++; g.total += i.nominal; }
    });
  });
  const out = Object.keys(groups).map(k => groups[k]);
  out.sort((a, b) => (a.tanggal !== b.tanggal ? (a.tanggal < b.tanggal ? 1 : -1) : (a.dapur < b.dapur ? -1 : 1)));
  return { ok: true, data: out };
}

// Penanda tangan Laporan Keuangan Periode: Akuntan dapur, Perwakilan Mitra/Yayasan (dari LPDH), dan Kepala SPPG (dari LPDH) beserta gambar TTD.
// Akses sama dengan Berita Acara (akuntan/pic hanya dapurnya; admin/yayasan/asisten semua).
function getPenandatangan(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = String(p.dapur || '');
  if (!dapurId) return { ok: false, error: 'Dapur wajib' };
  if (!baCanAccess(me, dapurId)) return { ok: false, error: 'Tidak berwenang' };
  const ak = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1)
    .find(u => String(u[4]).toLowerCase() === 'akuntan' && u[5] === dapurId && String(u[6]).toUpperCase() === 'YA');
  const ident = readIdentitasLPDH(dapurId) || {};
  const ttd = readTtdBatch([ak ? ak[0] : '', 'WAKIL_' + dapurId, 'KEPALA_' + dapurId]);
  return {
    ok: true,
    data: {
      akuntan: ak ? String(ak[3] || '') : String(ident.pengawas_nama || ''),
      wakil: String(ident.wakil_nama || ''),
      kepala: String(ident.kepala_nama || ''),
      ttd: {
        akuntan: (ak && ttd[ak[0]]) || null,
        wakil: ttd['WAKIL_' + dapurId] || null,
        kepala: ttd['KEPALA_' + dapurId] || null,
      },
    },
  };
}

function getBeritaAcara(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = String(p.dapur || me.dapur || '');
  const tanggal = String(p.tanggal || '').substring(0, 10);
  if (!dapurId || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return { ok: false, error: 'Dapur & tanggal wajib' };
  if (!baCanAccess(me, dapurId)) return { ok: false, error: 'Tidak berwenang mencetak Berita Acara dapur ini' };

  const heads = readAllPengajuan().filter(h => h.dapur === dapurId && h.tanggal === tanggal)
    .sort((a, b) => a.seq - b.seq);
  if (!heads.length) return { ok: false, error: 'Tidak ada pengajuan pada tanggal ' + tanggal };
  const headIds = heads.map(h => h.id);
  const all = readAllItems().filter(i => headIds.indexOf(i.pengajuan_id) >= 0);
  const menunggu = all.filter(i => i.status === 'MENUNGGU_ADMIN' || i.status === 'DIAJUKAN' || i.status === 'REVISI');
  if (menunggu.length) return { ok: false, error: 'Masih ada ' + menunggu.length + ' baris menunggu keputusan / revisi. Berita Acara bisa dicetak setelah semua baris hari ini diputuskan.' };
  const disetujui = all.filter(i => i.status === 'DISETUJUI' || i.status === 'TEREALISASI')
    .sort((a, b) => (headIds.indexOf(a.pengajuan_id) - headIds.indexOf(b.pengajuan_id)) || (a.urut - b.urut));
  if (!disetujui.length) return { ok: false, error: 'Tidak ada baris yang disetujui pada tanggal ini' };

  const users = getSheet(SHEETS.USERS).getDataRange().getValues().slice(1);
  const nama = {}; users.forEach(u => { nama[u[0]] = u[3]; });
  const akuntanRow = users.find(u => String(u[4]).toLowerCase() === 'akuntan' && u[5] === dapurId && String(u[6]).toUpperCase() === 'YA');
  const dapurRow = getDapur().data.find(d => d.id === dapurId) || {};
  const periode = readAllPeriode(dapurId).find(r => r.id === heads[0].periode_id) || {};
  const headBy = {}; heads.forEach(h => { headBy[h.id] = h; });

  const rows = disetujui.map(function(i, idx) {
    return { no: idx + 1, jenis: i.jenis, kategori: i.kategori, uraian: i.uraian, nominal: i.nominal,
      penerima: i.penerima_nama, bank: i.bank, no_rek: i.no_rek, susulan: i.susulan,
      diajukan_oleh: nama[headBy[i.pengajuan_id].created_by] || headBy[i.pengajuan_id].created_by,
      disetujui_oleh: nama[i.decided_by] || i.decided_by, disetujui_at: i.decided_at };
  });
  const total = rows.reduce((s, r) => s + r.nominal, 0);
  const sum = st => all.filter(i => st.indexOf(i.status) >= 0);
  const tidak = sum(['DITOLAK', 'DIBATALKAN']);
  const decidedTimes = disetujui.map(i => i.decided_at).filter(Boolean).sort();
  const penyetuju = [];
  disetujui.forEach(i => { const n = nama[i.decided_by] || i.decided_by; if (n && penyetuju.indexOf(n) < 0) penyetuju.push(n); });
  const nomorList = [];
  heads.forEach(h => { if (nomorList.indexOf(h.nomor) < 0) nomorList.push(h.nomor); });

  // Kode verifikasi: berubah bila isi (baris, nominal, rekening, status) berubah
  const canon = [nomorList.join(','), dapurId, tanggal].concat(disetujui.map(i =>
    [i.id, i.nominal, i.penerima_nama, i.bank, i.no_rek, i.status === 'TEREALISASI' ? 'DISETUJUI' : i.status, i.decided_at].join('~'))).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canon, Utilities.Charset.UTF_8);
  const hex = digest.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('').toUpperCase();
  const kodeVerifikasi = hex.substring(0, 4) + '-' + hex.substring(4, 8) + '-' + hex.substring(8, 12);

  logActivity(me.id, 'cetakBeritaAcara', nomorList.join(',') + ' ' + kodeVerifikasi);
  return { ok: true, data: {
    nomor: nomorList.join(' / '), tanggal: tanggal, yayasan: NAMA_YAYASAN,
    dapur: { id: dapurId, nama: dapurRow.nama || dapurId, kode: dapurRow.kode || '', alamat: dapurRow.alamat || '', telepon: dapurRow.telepon || '', email: dapurRow.email || '' },
    logo: readLogoKop(),
    periode: { no: periode.periode_no || '', mulai: periode.tanggal_mulai || '', akhir: periode.tanggal_akhir || '' },
    jumlah_pengajuan: heads.length,
    waktu_input: heads.map(h => ({ oleh: nama[h.created_by] || h.created_by, at: h.created_at })),
    rows: rows, total: total,
    ringkasan: { baris_diajukan: all.length, nominal_diajukan: all.reduce((s, i) => s + i.nominal, 0),
      baris_disetujui: rows.length, baris_tidak: tidak.length, nominal_tidak: tidak.reduce((s, i) => s + i.nominal, 0) },
    penyetuju: penyetuju, keputusan_terakhir: decidedTimes.length ? decidedTimes[decidedTimes.length - 1] : '',
    akuntan: akuntanRow ? { nama: akuntanRow[3], ttd: readTtdDataUrl(akuntanRow[0]) } : null,
    kode_verifikasi: kodeVerifikasi,
  } };
}

// ============================================================
//  RENCANA OPERASIONAL PER PERIODE
//  Pagu operasional LPDH = Rp 3.000 × PM × indeks kemahalan, per HARI (mutlak).
//  Akuntan menyusun rencana belanja operasional per hari; tiap hari bisa langsung diajukan.
//  Data rencana (JSON) disimpan per dapur per periode di sheet RencanaOps.
// ============================================================
const PAGU_OPS_PER_PM = 3000;
function rencanaSheet() { return sheetOtomatis(SHEETS.RENCANA, ['dapur_id', 'periode_id', 'data_json', 'updated_at', 'updated_by']); }
function bacaRencana(dapurId, periodeId) {
  const d = rencanaSheet().getDataRange().getValues();
  for (let i = 1; i < d.length; i++) if (d[i][0] === dapurId && d[i][1] === periodeId) return { _row: i + 1, data: bacaJson(d[i][2]) };
  return null;
}
function rencanaDapur(me, dapur) {
  if (me.role === 'akuntan' || me.role === 'pic') return me.dapur || null;
  if (me.role === 'admin' || me.role === 'yayasan') return String(dapur || '') || null;
  return null;
}
function periodeRencana(dapurId, periodeId) {
  const all = readAllPeriode(dapurId);
  return periodeId ? all.find(function(r) { return r.id === periodeId; }) : all.find(function(r) { return r.status === 'AKTIF'; });
}
// Operasional yang sudah terealisasi per tanggal (nilai LPDH = anggaran pengajuan)
function opsPerTanggal(dapurId, periodeId) {
  const out = {};
  readAllTransaksi([dapurId], periodeId).forEach(function(t) {
    if (t.jenis !== 'Operasional' || t.sumber === 'Petty Cash') return;
    out[t.tanggal] = (out[t.tanggal] || 0) + nilaiLPDH(t);
  });
  return out;
}
// Biaya admin transfer milik pembelian bahan baku per tanggal (nyata: transaksi + pengajuan aktif) & penanda tanggal yang sudah punya pengajuan/transaksi Bahan Baku.
// Jika Bahan Baku sudah diajukan/tercatat di tanggal itu, estimasi cadangan tidak lagi dipakai — otomatis mengikuti biaya admin yang diajukan/terealisasi.
function adminBBInfoPerTanggal(dapurId, periodeId, items) {
  const nyata = {}, belumRealisasi = {}, ada = {};
  const headMap = {};
  readAllPengajuan().forEach(function(h) { if (h.dapur === dapurId && h.periode_id === periodeId) headMap[h.id] = h; });
  readAllTransaksi([dapurId], periodeId).forEach(function(t) {
    if (t.jenis === 'Bahan Baku') ada[t.tanggal] = true;
    const l = String(t.pengajuan_item_id || '');
    if (!isFeeLink(l)) return;
    const it = items[l.substring(BIAYA_ADMIN_PREFIX.length)];
    if (it && it.jenis === 'Bahan Baku') {
      nyata[t.tanggal] = (nyata[t.tanggal] || 0) + nilaiLPDH(t);
      ada[t.tanggal] = true;
    }
  });
  Object.keys(items).forEach(function(k) {
    const it = items[k];
    if (it.dapur !== dapurId || it.periode_id !== periodeId || it.jenis !== 'Bahan Baku') return;
    if (['MENUNGGU_ADMIN', 'DIAJUKAN', 'REVISI', 'DISETUJUI', 'TEREALISASI'].indexOf(it.status) < 0) return;
    const h = headMap[it.pengajuan_id];
    const tgl = h ? h.tanggal : '';
    if (!tgl) return;
    ada[tgl] = true;
    if (it.status !== 'TEREALISASI' && !it.transaksi_id && it.biaya_admin > 0) {
      nyata[tgl] = (nyata[tgl] || 0) + it.biaya_admin;
      belumRealisasi[tgl] = (belumRealisasi[tgl] || 0) + it.biaya_admin;
    }
  });
  return { nyata: nyata, belumRealisasi: belumRealisasi, ada: ada };
}
function adminBBPerTanggal(dapurId, periodeId, items) {
  return adminBBInfoPerTanggal(dapurId, periodeId, items).nyata;
}
// Cadangan bawaan: rata-rata transfer bahan baku berbiaya admin per hari belanja pada periode terakhir yang punya datanya
function bbTransferBawaan(dapurId, periodeId, items) {
  const pers = readAllPeriode(dapurId).filter(function(r) { return r.id !== periodeId; }).sort(function(a, b) { return a.tanggal_mulai < b.tanggal_mulai ? 1 : -1; });
  for (let k = 0; k < pers.length; k++) {
    const tx = readAllTransaksi([dapurId], pers[k].id), hari = {}; let n = 0;
    tx.forEach(function(t) {
      const l = String(t.pengajuan_item_id || '');
      if (!isFeeLink(l)) return;
      const it = items[l.substring(BIAYA_ADMIN_PREFIX.length)];
      if (it && it.jenis === 'Bahan Baku') { n++; hari[t.tanggal] = 1; }
    });
    if (n && Object.keys(hari).length >= 3) return Math.round(n / Object.keys(hari).length);
  }
  return 0;
}
function getRencanaOps(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = rencanaDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const per = periodeRencana(dapurId, p.periode_id);
  if (!per) return { ok: false, error: 'Tidak ada periode aktif untuk dapur ini' };
  const items = {}; readAllItems().forEach(function(i) { items[i.id] = i; });
  // riwayat: periode sebelumnya yang punya transaksi operasional → dasar usulan
  const semuaPer = readAllPeriode(dapurId).filter(function(r) { return r.tanggal_mulai < per.tanggal_mulai; })
    .sort(function(a, b) { return a.tanggal_mulai < b.tanggal_mulai ? 1 : -1; });
  const semuaTx = readAllTransaksi([dapurId]);
  // periode terakhir yang datanya cukup (≥ 3 hari belanja bahan baku & ≥ 5 transaksi operasional selain sewa kendaraan);
  // periode yang pencatatannya belum lengkap dilewati, dicatat di 'dilewati'
  let riwayat = null, cadangan = null; const dilewati = [];
  for (let k = 0; k < semuaPer.length && !riwayat; k++) {
    const pr = semuaPer[k];
    const tx = semuaTx.filter(function(t) { return t.periode_id === pr.id; });
    const ops = tx.filter(function(t) { return t.jenis === 'Operasional' && t.kategori !== 'Biaya Admin Bank' && !isFeeLink(t.pengajuan_item_id); });
    if (!ops.length) { dilewati.push(pr.periode_no); continue; }
    const hariBB = {}; tx.forEach(function(t) { if (t.jenis === 'Bahan Baku') hariBB[t.tanggal] = 1; });
    const cukup = Object.keys(hariBB).length >= 3 && ops.filter(function(t) { return t.kategori !== 'Sewa Kendaraan'; }).length >= 5;
    const cand = { periode_no: pr.periode_no, hari: Math.max(1, Object.keys(hariBB).length),
      tx: ops.map(function(t) { const it = items[String(t.pengajuan_item_id)]; return { tanggal: t.tanggal, kategori: t.kategori, uraian: String(t.uraian || ''),
        nominal: nilaiLPDH(t), penerima_id: it ? it.penerima_id : '' }; }) };
    if (cukup) riwayat = cand; else { dilewati.push(pr.periode_no); if (!cadangan) cadangan = cand; }
  }
  if (!riwayat) riwayat = cadangan;
  if (riwayat) riwayat.dilewati = dilewati.filter(function(n) { return n !== riwayat.periode_no; });
  const ada = bacaRencana(dapurId, per.id);
  const rencana = ada ? ada.data : null;
  // status pengajuan yang dibuat dari rencana
  const status = {};
  if (rencana && rencana.items) {
    const pids = {}; rencana.items.forEach(function(x) { if (x.pengajuan_id) pids[x.pengajuan_id] = 1; });
    Object.keys(items).forEach(function(k) { const it = items[k]; if (pids[it.pengajuan_id]) (status[it.pengajuan_id] = status[it.pengajuan_id] || []).push(it.status); });
  }
  // Operasional di luar rencana (pengajuan dari menu Pengajuan, input darurat/manual) — ikut menghabiskan pagu harian
  const pidRencana = {}; ((rencana && rencana.items) || []).forEach(function(x) { if (x.pengajuan_id) pidRencana[x.pengajuan_id] = 1; });
  const headMap = {}; readAllPengajuan().forEach(function(h) { headMap[h.id] = h; });
  const txPer = semuaTx.filter(function(t) { return t.periode_id === per.id; }), txMap = {}; txPer.forEach(function(t) { txMap[t.id] = t; });
  const luar = [];
  Object.keys(items).forEach(function(k) {
    const it = items[k];
    if (it.dapur !== dapurId || it.periode_id !== per.id || it.jenis !== 'Operasional' || pidRencana[it.pengajuan_id]) return;
    if (['MENUNGGU_ADMIN', 'DIAJUKAN', 'REVISI', 'DISETUJUI', 'TEREALISASI'].indexOf(it.status) < 0) return;
    const h = headMap[it.pengajuan_id] || {}, tx = it.transaksi_id ? txMap[it.transaksi_id] : null;
    luar.push({ id: 'LUAR-' + it.id, pitem_id: it.id, tanggal: tx ? tx.tanggal : h.tanggal, kategori: it.kategori, uraian: it.uraian, nominal: tx ? nilaiLPDH(tx) : it.nominal,
      penerima_id: it.penerima_id, pengajuan_id: it.pengajuan_id, nomor: h.nomor || '', status: it.status });
  });
  txPer.forEach(function(t) {   // transaksi operasional tanpa pengajuan (darurat / manual)
    const l = String(t.pengajuan_item_id || '');
    if (t.jenis !== 'Operasional' || t.sumber === 'Petty Cash' || (l && l.indexOf('DARURAT') !== 0)) return;   // biaya admin manual ikut dihitung
    luar.push({ id: 'LUAR-' + t.id, tanggal: t.tanggal, kategori: t.kategori, uraian: String(t.uraian || ''), nominal: nilaiLPDH(t), penerima_id: '', pengajuan_id: '', nomor: String(t.no_bukti || ''), status: 'TRANSAKSI' });
  });
  const ident = readIdentitasLPDH(dapurId) || {};
  const bbInfo = adminBBInfoPerTanggal(dapurId, per.id, items);
  const pmPop = {};
  try {
    const hdAll = harianSheet().getDataRange().getValues();
    for (let i = 1; i < hdAll.length; i++) {
      if (hdAll[i][0] !== dapurId) continue;
      const tgl = tglTeks(hdAll[i][1]);
      if (tgl < per.tanggal_mulai || tgl > per.tanggal_akhir) continue;
      const jd = bacaJson(hdAll[i][2]);
      if (!jd) continue;
      const totSk = (jd.sekolah || []).length
        ? jd.sekolah.filter(function(s) { return s.dikirim !== false; }).reduce(function(a, s) { return a + (Number(s.besar) || 0) + (Number(s.kecil) || 0); }, 0)
        : (jd.pm || []).reduce(function(a, x) { return a + (Number(x.distribusi) || 0); }, 0);
      const totProd = Number(jd.produksi && jd.produksi.total) || 0;
      pmPop[tgl] = totProd > 0 ? totProd : totSk;
    }
  } catch (e) {}
  return { ok: true, data: {
    dapur: dapurId,
    periode: { id: per.id, periode_no: per.periode_no, tanggal_mulai: per.tanggal_mulai, tanggal_akhir: per.tanggal_akhir, penerima: per.penerima, status: per.status },
    rencana: rencana, riwayat: riwayat, status: status, luar: luar,
    dapurNama: ((getDapur().data || []).find(function(x) { return x.id === dapurId; }) || {}).nama || '', bankVA: String(ident.bank || ''),
    aktual: opsPerTanggal(dapurId, per.id), adminBB: bbInfo.nyata, adminBBAda: bbInfo.ada, bbDefault: bbTransferBawaan(dapurId, per.id, items), pmPop: pmPop,
    penerima: readPenerima().filter(function(r) { return r.aktif; }).map(function(r) { return { id: r.id, nama: r.nama, bank: r.bank, no_rek: r.no_rek }; })
      .sort(function(a, b) { return a.nama.localeCompare(b.nama); }),
    bisaUbah: me.role === 'akuntan' || me.role === 'admin' } };
}
function saveRencanaOps(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  if (me.role !== 'akuntan' && me.role !== 'admin') return { ok: false, error: 'Hanya akuntan atau admin' };
  const dapurId = rencanaDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const per = periodeRencana(dapurId, p.periode_id);
  if (!per) return { ok: false, error: 'Periode tidak ditemukan' };
  if (per.status !== 'AKTIF') return { ok: false, error: 'Periode sudah ditutup' };
  let d = p.data;
  if (typeof d === 'string') d = bacaJson(d);
  if (!d || typeof d !== 'object') return { ok: false, error: 'Data rencana tidak valid' };
  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length > 400) return { ok: false, error: 'Rencana maksimal 400 baris' };
  const kat = JENIS_KATEGORI['Operasional'];
  const bersih = { versi: (Number(d.versi) || 0) + 1, setelan: { indeks: Math.min(300, Math.max(50, Number((d.setelan || {}).indeks) || 100)), batas: Math.min(100, Math.max(50, Number((d.setelan || {}).batas) || 95)),
      bb: Math.min(60, Math.max(0, Math.round(Number((d.setelan || {}).bb) || 0))) },
    hari: {}, items: [] };
  Object.keys(d.hari || {}).forEach(function(t) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || t < per.tanggal_mulai || t > per.tanggal_akhir) return;
    const h = d.hari[t] || {}; bersih.hari[t] = { pm: Math.max(0, Math.round(Number(h.pm) || 0)), libur: !!h.libur };
  });
  for (let i = 0; i < items.length; i++) {
    const x = items[i] || {};
    const tgl = String(x.tanggal || '');
    if (tgl && (!/^\d{4}-\d{2}-\d{2}$/.test(tgl) || tgl < per.tanggal_mulai || tgl > per.tanggal_akhir)) return { ok: false, error: 'Baris ' + (i + 1) + ': tanggal di luar periode' };
    if (kat.indexOf(x.kategori) < 0) return { ok: false, error: 'Baris ' + (i + 1) + ': kategori operasional tidak valid' };
    const nom = Math.round(Number(x.nominal) || 0);
    if (!(nom > 0)) return { ok: false, error: 'Baris ' + (i + 1) + ': nominal wajib > 0' };
    const nUrl = cekNotaUrl(x.nota_url);
    if (nUrl === null) return { ok: false, error: 'Baris ' + (i + 1) + ': tautan bukti/nota tidak valid' };
    const item = { id: String(x.id || idUnik('RO')).substring(0, 40), tanggal: tgl, kategori: x.kategori, uraian: String(x.uraian || '').trim().substring(0, 200),
      nominal: nom, penerima_id: String(x.penerima_id || '').substring(0, 40), rutin: !!x.rutin, bagian: String(x.bagian || '').substring(0, 10),
      pengajuan_id: String(x.pengajuan_id || '').substring(0, 60), nomor: String(x.nomor || '').substring(0, 60) };
    if (butuhRencanaRealisasi('Operasional', x.kategori) && Number(x.rencana_riil) > 0) item.rencana_riil = Math.round(Number(x.rencana_riil));
    if (nUrl) item.nota_url = nUrl;
    const nNo = String(x.nota_no || '').trim().substring(0, 60);
    if (nNo) item.nota_no = nNo;
    if (x.biaya_admin !== undefined && x.biaya_admin !== '' && x.biaya_admin !== null) {
      const fv = parseFee(x.biaya_admin);
      if (fv < 0) return { ok: false, error: 'Baris ' + (i + 1) + ': biaya admin tidak valid' };
      item.biaya_admin = fv;
    }
    bersih.items.push(item);
  }
  const json = JSON.stringify(bersih);
  if (json.length > 45000) return { ok: false, error: 'Rencana terlalu besar — kurangi jumlah baris' };
  return withLock(function() {
    const ada = bacaRencana(dapurId, per.id);
    const versiAda = ada && ada.data ? Number(ada.data.versi) || 0 : 0;
    if (versiAda !== (Number(d.versi) || 0)) return { ok: false, error: 'Rencana sudah diubah di perangkat lain. Muat ulang halaman, lalu ulangi perubahan Anda.' };
    const sh = rencanaSheet();
    if (ada) sh.getRange(ada._row, 3, 1, 3).setValues([[json, new Date(), me.id]]);
    else sh.appendRow([dapurId, per.id, json, new Date(), me.id]);
    logActivity(me.id, 'saveRencanaOps', dapurId + ' ' + per.id + ' v' + bersih.versi + ' (' + bersih.items.length + ' baris)');
    return { ok: true, data: { versi: bersih.versi } };
  });
}
// Pagu operasional hari itu & yang sudah terpakai (untuk peringatan saat pengajuan)
function getPaguOps(p) {
  const me = authUser(p);
  if (!me) return { ok: false, error: SESI_ERR };
  const dapurId = rencanaDapur(me, p.dapur);
  if (!dapurId) return { ok: false, error: 'Pilih dapur' };
  const tgl = String(p.tanggal || '').substring(0, 10);
  const per = readAllPeriode(dapurId).find(function(r) { return tgl >= r.tanggal_mulai && tgl <= r.tanggal_akhir; });
  if (!per) return { ok: true, data: null };
  const r = bacaRencana(dapurId, per.id), d = r && r.data ? r.data : {};
  const h = (d.hari || {})[tgl] || {}, set = d.setelan || {};
  const pm = h.pm > 0 ? h.pm : per.penerima;
  const indeks = Number(set.indeks) || 100;
  const dow = new Date(tgl + 'T00:00:00Z').getUTCDay();
  const libur = h.libur !== undefined ? !!h.libur : (dow === 0 || dow === 6);   // Sabtu/Minggu bukan HPE kecuali diatur lain
  // pengajuan operasional hari H itu yang belum terealisasi (menunggu / revisi / disetujui lama) — untuk peringatan di form Pengajuan
  const heads = {}; readAllPengajuan().forEach(function(x) { if (x.dapur === dapurId && x.tanggal === tgl) heads[x.id] = 1; });
  let diajukan = 0, nDiajukan = 0;
  readAllItems().forEach(function(it) {
    if (!heads[it.pengajuan_id] || it.jenis !== 'Operasional' || ['MENUNGGU_ADMIN', 'DIAJUKAN', 'REVISI', 'DISETUJUI'].indexOf(it.status) < 0) return;
    diajukan += it.nominal + (it.biaya_admin || 0); nDiajukan++;
  });
  const rencanaBelum = ((d.items || []).filter(function(x) { return x.tanggal === tgl && !x.pengajuan_id; })).reduce(function(a, x) { return a + (Number(x.nominal) || 0); }, 0);
  const ident = readIdentitasLPDH(dapurId) || {};
  return { ok: true, data: { tanggal: tgl, pm: pm, indeks: indeks, libur: libur, pagu: libur ? 0 : Math.round(PAGU_OPS_PER_PM * pm * indeks / 100),
    terpakai: opsPerTanggal(dapurId, per.id)[tgl] || 0, cadanganBB: (function() {
      const items = {}; readAllItems().forEach(function(i) { items[i.id] = i; });
      const info = adminBBInfoPerTanggal(dapurId, per.id, items);
      if (info.ada[tgl]) return info.belumRealisasi[tgl] || 0;
      const bb = set.bb !== undefined ? Number(set.bb) || 0 : bbTransferBawaan(dapurId, per.id, items);
      return libur ? 0 : Math.max(0, bb * 6500); })(), diajukan: diajukan, nDiajukan: nDiajukan, rencanaBelum: rencanaBelum, bankVA: String(ident.bank || '') } };
}
