// Uji logika backend/Code.gs di Node dengan layanan Apps Script tiruan (Utilities, Cache, Lock, Spreadsheet).
// Jalankan: npm run test:backend   (tidak butuh internet, Google, atau data asli; semua data di sini tiruan)
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const FILE = process.argv[2] || require('path').join(__dirname, '..', 'backend', 'Code.gs');

// Google Sheets menyimpan "'teks" sebagai teks tanpa tanda kutip
const tampilSheets = v => (typeof v === 'string' && v[0] === "'" ? v.slice(1) : v);
function makeEnv(usersInit, transform) {
  const book = {
    Users: [['id','username','password','nama','role','dapur_id','aktif'], ...usersInit],
    Sesi: [['token','user_id','at']],
    Log: [['t','u','a','r']],
    Dapur: [['id','nama','alamat','kode'], ['D001','SPPG Satu','','S1']],
    Setup: [['id','dapur','no','mulai','akhir','penerima','va','petty','status'], ['P1','D001',1,'2026-10-01','2026-10-31',100,5000000,0,'AKTIF']],
    Penerima: [['id','nama','bank','no_rek','aktif'], ['pn1','Toko A','BCA','123','YA']],
    Pengajuan: [['id','nomor','dapur','periode','tgl','status','at','by','dat','dby']],
    PengajuanItem: [['h']], VATopup: [['h']], PettyTopup: [['h']], Transaksi: [['h']],
  };
  const sheet = name => ({
    getDataRange: () => ({ getValues: () => {
      const rows = book[name].map(r => r.slice());
      // tiru Google yang belum "melihat" baris terbaru Sesi (baca basi)
      if (name === 'Sesi' && sandbox.__sesiBasi > 0) { sandbox.__sesiBasi--; rows.pop(); }
      return rows;
    } }),
    getRange: (r, c, nr, nc) => ({
      setValue: v => { book[name][r - 1][c - 1] = tampilSheets(v); },
      getDisplayValues: () => book[name].slice(r - 1, r - 1 + nr).map(row => Array.from({ length: nc || 1 }, (_, j) => String(row[c - 1 + j] == null ? '' : row[c - 1 + j]))),
      setValues: vals => { vals.forEach((row, i) => { book[name][r - 1 + i] = book[name][r - 1 + i] || []; row.forEach((v, j) => { book[name][r - 1 + i][c - 1 + j] = tampilSheets(v); }); }); },
    }),
    appendRow: row => { if (name === 'Sesi' && sandbox.__appendGagal > 0) { sandbox.__appendGagal--; throw new Error('Layanan Spreadsheet gagal'); } book[name].push(row.map(tampilSheets)); },
    deleteRow: n => { book[name].splice(n - 1, 1); },
    getLastRow: () => book[name].length,
  });
  const cacheStore = {};
  const sandbox = {
    console, Logger: { log: m => (sandbox.__logs.push(m)) }, __logs: [],
    __openGagal: 0, __sesiBasi: 0, __appendGagal: 0, __aktifBisa: false,
    SpreadsheetApp: {
      // tiru gangguan sesaat Google: openById melempar galat "izin" sebanyak __openGagal kali
      openById: () => { if (sandbox.__openGagal > 0) { sandbox.__openGagal--; throw new Error('Anda tidak memiliki izin untuk mengakses dokumen yang diminta.'); }
        return { getSheetByName: n => (book[n] ? sheet(n) : null), insertSheet: n => { book[n] = []; return sheet(n); } }; },
      getActiveSpreadsheet: () => (sandbox.__aktifBisa ? { getId: () => sandbox.SPREADSHEET_ID_TES, getSheetByName: n => (book[n] ? sheet(n) : null) } : null),
      flush() {},
    },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; },
      remove: k => { delete cacheStore[k]; }, removeAll: ks => ks.forEach(k => delete cacheStore[k]) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, bytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes.map(b => b & 255))).digest()).map(b => (b > 127 ? b - 256 : b)),
      newBlob: s => ({ getBytes: () => Array.from(Buffer.from(s, 'utf8')).map(b => (b > 127 ? b - 256 : b)) }),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      formatDate: (d, tz, f) => { const x = new Date(d); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); },
    },
    Date, JSON, Math, Number, String, parseInt, Intl, Array, Object, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(transform ? transform(fs.readFileSync(FILE, 'utf8')) : fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'Code.gs' });
  sandbox.__book = book; sandbox.__cache = cacheStore;
  return sandbox;
}
// Tiap permintaan di Apps Script = eksekusi baru → buang handle spreadsheet yang disimpan kode
const call = (env, method, params) => (vm.runInContext('if (typeof _SS !== "undefined") _SS = null; SPREADSHEET_ID_TES = SPREADSHEET_ID;', env), JSON.parse(env.handleRequest({ parameter: method === 'GET' ? params : {}, postData: method === 'POST' ? { contents: JSON.stringify(params) } : null }, method).s));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(function main() {
  // pengguna lama: password teks biasa
  const env = makeEnv([
    ['U1', 'admin', 'admin123', 'Super', 'admin', '', 'YA'],
    ['U2', 'akun1', 'RahasiaKu9', 'Akuntan', 'akuntan', 'D001', 'YA'],
    ['U3', 'off', 'xxxxxxx', 'Nonaktif', 'pic', 'D001', 'TIDAK'],
  ]);
  const B = env.__book;
  ok(call(env, 'GET', { action: 'ping' }).version === 'v6-ba-sec6', 'ping menampilkan versi baru');

  // 1. login lama (teks biasa) berhasil via POST dan password otomatis di-hash
  let r = call(env, 'POST', { action: 'login', username: 'AKUN1', password: 'RahasiaKu9' });
  ok(r.ok && r.data.token, 'login POST dengan password lama berhasil');
  ok(B.Users[2][2].startsWith('h1$') && !B.Users[2][2].includes('RahasiaKu9'), 'password otomatis di-hash di sheet, tidak mengandung teks asli');
  r = call(env, 'POST', { action: 'login', username: 'akun1', password: 'RahasiaKu9' });
  ok(r.ok, 'login kedua (sudah hash) tetap berhasil');
  ok(!call(env, 'POST', { action: 'login', username: 'akun1', password: 'salah' }).ok, 'password salah ditolak');
  ok(!call(env, 'POST', { action: 'login', username: 'off', password: 'xxxxxxx' }).ok, 'akun nonaktif ditolak');

  // 2. throttling
  const e2 = makeEnv([['U1', 'adm', 'benar12', 'A', 'admin', '', 'YA']]);
  for (let i = 0; i < 5; i++) call(e2, 'POST', { action: 'login', username: 'adm', password: 'x' + i });
  r = call(e2, 'POST', { action: 'login', username: 'adm', password: 'benar12' });
  ok(!r.ok && /Terlalu banyak/.test(r.error), 'setelah 5x salah, login (walau benar) ditahan');

  // 3. getUsers tidak membocorkan password
  const tokAdmin = call(env, 'POST', { action: 'login', username: 'admin', password: 'admin123' }).data.token;
  r = call(env, 'POST', { action: 'getUsers', token: tokAdmin });
  ok(r.ok && r.data.length === 3 && r.data.every(u => !('password' in u)), 'getUsers tidak mengirim kolom password');
  ok(!JSON.stringify(r).includes('h1$') && !JSON.stringify(r).includes('admin123'), 'respons getUsers tidak memuat hash/teks password');

  // 4. addUser / updateUser menyimpan hash, validasi minimal
  r = call(env, 'POST', { action: 'addUser', token: tokAdmin, username: 'baru', password: 'abc', nama: 'B', target_role: 'pic', dapur: 'D001' });
  ok(!r.ok && /minimal/.test(r.error), 'password pendek ditolak saat tambah user');
  r = call(env, 'POST', { action: 'addUser', token: tokAdmin, username: 'baru', password: 'abcdef1', nama: 'B', target_role: 'pic', dapur: 'D001' });
  ok(r.ok && B.Users[B.Users.length - 1][2].startsWith('h1$'), 'user baru tersimpan dengan password ter-hash');
  ok(call(env, 'POST', { action: 'login', username: 'baru', password: 'abcdef1' }).ok, 'user baru bisa login');

  // 5. reset password oleh admin mencabut sesi lama user itu
  const tokU2 = call(env, 'POST', { action: 'login', username: 'akun1', password: 'RahasiaKu9' }).data.token;
  ok(call(env, 'POST', { action: 'getMyProfile', token: tokU2 }).ok, 'sesi akun1 valid sebelum reset');
  r = call(env, 'POST', { action: 'updateUser', token: tokAdmin, id: 'U2', password: 'PasswordBaru1' });
  ok(r.ok, 'admin reset password akun1');
  ok(!call(env, 'POST', { action: 'getMyProfile', token: tokU2 }).ok, 'sesi lama akun1 dicabut setelah reset');
  ok(call(env, 'POST', { action: 'login', username: 'akun1', password: 'PasswordBaru1' }).ok, 'login dengan password baru berhasil');
  ok(!call(env, 'POST', { action: 'login', username: 'akun1', password: 'RahasiaKu9' }).ok, 'password lama tidak berlaku lagi');

  // 6. ganti password sendiri: sesi ini tetap, sesi lain dicabut
  const tA = call(env, 'POST', { action: 'login', username: 'akun1', password: 'PasswordBaru1' }).data.token;
  const tB = call(env, 'POST', { action: 'login', username: 'akun1', password: 'PasswordBaru1' }).data.token;
  r = call(env, 'POST', { action: 'updateMyProfile', token: tA, nama: 'Akuntan', username: 'akun1', password_lama: 'salah!', password_baru: 'GantiLagi1' });
  ok(!r.ok && /lama salah/.test(r.error), 'ganti password dengan password lama salah ditolak');
  r = call(env, 'POST', { action: 'updateMyProfile', token: tA, nama: 'Akuntan', username: 'akun1', password_lama: 'PasswordBaru1', password_baru: 'GantiLagi1' });
  ok(r.ok, 'ganti password sendiri berhasil');
  ok(call(env, 'POST', { action: 'getMyProfile', token: tA }).ok, 'sesi yang dipakai tetap hidup');
  ok(!call(env, 'POST', { action: 'getMyProfile', token: tB }).ok, 'sesi perangkat lain dicabut');

  // 7. migrasi massal
  const e3 = makeEnv([['U1', 'a', 'admin123', 'A', 'admin', '', 'YA'], ['U2', 'b', 'Kuat-Sekali-77', 'B', 'pic', 'D001', 'YA'], ['U3', 'c', '123', 'C', 'pic', 'D001', 'YA']]);
  e3.migrasiHashPassword();
  ok(e3.__book.Users.slice(1).every(u => u[2].startsWith('h1$')), 'migrasi: semua password ter-hash');
  ok(e3.__logs.join(' ').includes('Di-hash: 3') && /a, c/.test(e3.__logs.join(' ')), 'migrasi: melaporkan akun bawaan/lemah (a, c) tanpa menampilkan passwordnya');
  e3.migrasiHashPassword();
  ok(e3.__logs.join(' ').includes('Sudah ter-hash sebelumnya: 3'), 'migrasi aman diulang');
  ok(call(e3, 'POST', { action: 'login', username: 'b', password: 'Kuat-Sekali-77' }).ok, 'login setelah migrasi massal berhasil');

  // 8. blokir aksi berpassword via GET (saat dimatikan)
  const e4 = makeEnv([['U1', 'a', 'pass123', 'A', 'admin', '', 'YA']], src => src.replace('const LOGIN_VIA_GET_DIBOLEH = false;', 'const LOGIN_VIA_GET_DIBOLEH = true;'));
  ok(call(e4, 'GET', { action: 'login', username: 'a', password: 'pass123' }).ok, 'GET login masih boleh bila LOGIN_VIA_GET_DIBOLEH = true');
  ok(/const LOGIN_VIA_GET_DIBOLEH = false;/.test(fs.readFileSync(FILE, 'utf8')), 'sec4: LOGIN_VIA_GET_DIBOLEH = false di kode yang akan dipasang');
  const e5 = makeEnv([['U1', 'a', 'pass123', 'A', 'admin', '', 'YA']]);
  r = call(e5, 'GET', { action: 'login', username: 'a', password: 'pass123' });
  ok(!r.ok && /Muat ulang/.test(r.error), 'GET login ditolak saat LOGIN_VIA_GET_DIBOLEH = false');
  ok(call(e5, 'POST', { action: 'login', username: 'a', password: 'pass123' }).ok, 'POST login tetap jalan saat GET dimatikan');

  // 9. createPengajuan idempoten
  const tk = call(env, 'POST', { action: 'login', username: 'akun1', password: 'GantiLagi1' }).data.token;
  const items = [{ jenis: 'Bahan Baku', kategori: 'Beras', uraian: 'Beras 50kg', nominal: 600000, penerima_id: 'pn1' }];
  const JK = vm.runInContext('JENIS_KATEGORI', env);
  const jenis = Object.keys(JK)[0]; items[0].jenis = jenis; items[0].kategori = JK[jenis][0];
  const a = call(env, 'POST', { action: 'createPengajuan', token: tk, tanggal: '2026-10-15', items, request_id: 'rq-abc' });
  ok(a.ok && a.data.nomor, 'createPengajuan pertama berhasil: ' + (a.error || a.data.nomor));
  const n1 = B.Pengajuan.length;
  const b = call(env, 'POST', { action: 'createPengajuan', token: tk, tanggal: '2026-10-15', items, request_id: 'rq-abc' });
  ok(b.ok && b.data.id === a.data.id && b.data.nomor === a.data.nomor, 'kirim ulang dengan request_id sama → hasil identik');
  ok(B.Pengajuan.length === n1, 'kirim ulang TIDAK menambah baris pengajuan');
  const c = call(env, 'POST', { action: 'createPengajuan', token: tk, tanggal: '2026-10-15', items, request_id: 'rq-lain' });
  ok(c.ok && c.data.id !== a.data.id && B.Pengajuan.length === n1 + 1, 'request_id berbeda → pengajuan baru dibuat');
  const d = call(env, 'POST', { action: 'createPengajuan', token: tk, tanggal: '2026-10-15', items });
  ok(d.ok && d.data.id !== a.data.id, 'tanpa request_id perilaku lama tetap jalan');

  // 10. hak persetujuan: yayasan, pic (dapur sendiri), admin; akuntan ditolak
  const e6 = makeEnv([
    ['U1', 'adm', 'passwd1', 'Admin', 'admin', '', 'YA'], ['U2', 'yay', 'passwd2', 'Yayasan', 'yayasan', '', 'YA'],
    ['U3', 'akn', 'passwd3', 'Akuntan', 'akuntan', 'D001', 'YA'], ['U4', 'pic1', 'passwd4', 'PIC Satu', 'pic', 'D001', 'YA'],
    ['U5', 'pic2', 'passwd5', 'PIC Dua', 'pic', 'D002', 'YA'],
  ]);
  e6.__book.Dapur.push(['D002', 'SPPG Dua', '', 'S2']);
  const tok = u => call(e6, 'POST', { action: 'login', username: u, password: { adm: 'passwd1', yay: 'passwd2', akn: 'passwd3', pic1: 'passwd4', pic2: 'passwd5' }[u] }).data.token;
  const JK2 = vm.runInContext('JENIS_KATEGORI', e6); const j2 = Object.keys(JK2)[0];
  const it2 = [{ jenis: j2, kategori: JK2[j2][0], uraian: 'Beras', nominal: 100000, penerima_id: 'pn1' }];
  function baru(n) {
    const r = call(e6, 'POST', { action: 'createPengajuan', token: tok('akn'), tanggal: '2026-10-15', items: it2.map(x => Object.assign({}, x, { uraian: 'Beras ' + n })), request_id: 'k' + n });
    const itemId = e6.__book.PengajuanItem[e6.__book.PengajuanItem.length - 1][0];
    return { id: r.data.id, item: itemId };
  }
  const dec = (u, g) => call(e6, 'POST', { action: 'decidePengajuan', token: tok(u), pengajuan_id: g.id, keputusan: [{ item_id: g.item, status: 'DISETUJUI' }] });
  let g = baru(1);
  ok(!dec('akn', g).ok, 'akuntan TIDAK boleh memutuskan');
  r = dec('pic2', g);
  ok(!r.ok && /dapurnya sendiri/.test(r.error), 'PIC dapur lain ditolak: ' + r.error);
  r = dec('pic1', g);
  ok(r.ok, 'PIC dapur yang sama boleh menyetujui: ' + (r.error || 'ok'));
  g = baru(2); r = dec('yay', g); ok(r.ok, 'Yayasan tetap boleh menyetujui');
  g = baru(3); r = dec('adm', g); ok(r.ok, 'Admin boleh menyetujui');
  r = call(e6, 'POST', { action: 'getPengajuan', token: tok('adm'), scope: 'ALL' }); if (!r.ok) console.log('getPengajuan error:', r.error);
  const roles = r.data.pengajuan.map(h => h.decided_by_nama + ':' + h.decided_by_role).sort();
  ok(roles.join('|') === 'Admin:admin|PIC Satu:pic|Yayasan:yayasan', 'tercatat siapa & perannya yang memutuskan: ' + roles.join(', '));
  ok(call(e6, 'POST', { action: 'getPengajuan', token: tok('pic1'), scope: 'ALL' }).data.pengajuan.length === 3, 'PIC melihat pengajuan dapurnya');
  ok(call(e6, 'POST', { action: 'getPengajuan', token: tok('pic2'), scope: 'ALL' }).data.pengajuan.length === 0, 'PIC dapur lain tidak melihat pengajuan dapur ini');

  // 11. getBADaftar: mode hari / aktif / periode + akses asisten
  e6.__book.Users.push(['U6', 'ast', 'passwd6', 'Asisten', 'asisten', '', 'YA']);
  const pwd6 = { adm: 'passwd1', yay: 'passwd2', akn: 'passwd3', pic1: 'passwd4', pic2: 'passwd5', ast: 'passwd6' };
  const tok6 = u => call(e6, 'POST', { action: 'login', username: u, password: pwd6[u] }).data.token;
  // periode lama yang sudah ditutup + 1 pengajuan di dalamnya (disisipkan langsung)
  e6.__book.Setup.push(['P0', 'D001', 0, '2026-09-01', '2026-09-30', 100, 1000000, 0, 'DITUTUP']);
  e6.__book.Pengajuan.push(['PAOLD', 'BA-PA/S1/2026/09/001', 'D001', 'P0', '2026-09-10', 'SELESAI', new Date(), 'U3', new Date(), 'U2']);
  e6.__book.PengajuanItem.push(['PAOLD-1', 'PAOLD', 'D001', 'P0', 1, 'Bahan Baku', 'x', 'Lama', 50000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI', '', 1, new Date(), 'U2', '', new Date(), new Date()]);
  const ba = (u, prm) => call(e6, 'POST', Object.assign({ action: 'getBADaftar', token: tok6(u) }, prm));
  r = ba('ast', {});
  ok(r.ok && r.data.length === 2, 'asisten kini bisa melihat Berita Acara (semua: ' + (r.data || []).length + ' grup)');
  r = ba('ast', { mode: 'hari', tanggal: '2026-10-15' });
  ok(r.ok && r.data.length === 1 && r.data[0].tanggal === '2026-10-15' && r.data[0].disetujui === 3, 'mode hari: hanya hari H itu, 3 baris disetujui terhitung');
  r = ba('ast', { mode: 'hari', tanggal: '2026-10-16' });
  ok(r.ok && r.data.length === 0, 'mode hari: tanggal tanpa pengajuan → kosong');
  r = ba('adm', { mode: 'aktif' });
  ok(r.ok && r.data.length === 1 && r.data[0].periode_status === 'AKTIF', 'mode aktif: periode ditutup tidak ikut');
  r = ba('adm', { mode: 'periode', periode_id: 'P0' });
  ok(r.ok && r.data.length === 1 && r.data[0].tanggal === '2026-09-10' && r.data[0].total === 50000, 'mode periode: Berita Acara periode ditutup tetap bisa diambil');
  r = ba('adm', { mode: 'periode' });
  ok(!r.ok, 'mode periode tanpa periode_id ditolak');
  r = ba('adm', { scope: 'D002' });
  ok(r.ok && r.data.length === 0, 'scope dapur lain → kosong');
  r = ba('pic2', {});
  ok(r.ok && r.data.length === 0, 'PIC dapur lain tetap tidak melihat Berita Acara dapur ini');
  r = ba('akn', { mode: 'aktif' });
  ok(r.ok && r.data.length === 1, 'akuntan dapurnya sendiri tetap bisa');
  r = call(e6, 'POST', { action: 'getBeritaAcara', token: tok6('ast'), dapur: 'D001', tanggal: '2026-10-15' });
  ok(!/Tidak berwenang/.test(r.error || ''), 'asisten tidak ditolak saat mencetak (' + (r.ok ? 'ok' : r.error) + ')');

  // 12. getPenandatangan: nama akuntan dapur, akses dibatasi
  const pt = (u, d) => call(e6, 'POST', { action: 'getPenandatangan', token: tok6(u), dapur: d });
  r = pt('adm', 'D001'); ok(r.ok && r.data.akuntan === 'Akuntan', 'admin mendapat nama akuntan D001: ' + JSON.stringify(r.data));
  ok(Object.keys(r.data).join(',') === 'akuntan', 'hanya nama yang dikirim (tanpa data lain)');
  r = pt('yay', 'D001'); ok(r.ok && r.data.akuntan === 'Akuntan', 'yayasan mendapat nama akuntan');
  r = pt('pic1', 'D001'); ok(r.ok && r.data.akuntan === 'Akuntan', 'PIC dapur sendiri mendapat nama akuntan');
  r = pt('pic2', 'D001'); ok(r.ok && r.data.akuntan === '', 'PIC dapur lain: dapur dipaksa ke dapurnya sendiri (D002, tanpa akuntan) → kosong, bukan nama akuntan D001');
  r = pt('adm', 'D002'); ok(r.ok && r.data.akuntan === '', 'dapur tanpa akuntan aktif → kosong');
  r = pt('adm', ''); ok(!r.ok, 'dapur kosong ditolak');
  e6.__book.Users.forEach(u => { if (u[0] === 'U3') u[6] = 'TIDAK'; });
  r = pt('adm', 'D001'); ok(r.ok && r.data.akuntan === '', 'akuntan nonaktif tidak dipakai');

  // 13. sec4: aksi berpassword lain lewat GET juga ditolak, aksi biasa lewat GET tetap jalan
  const tk5 = call(e5, 'POST', { action: 'login', username: 'a', password: 'pass123' }).data.token;
  r = call(e5, 'GET', { action: 'updateMyProfile', token: tk5, nama: 'A', username: 'a', password_lama: 'pass123', password_baru: 'baru1234' });
  ok(!r.ok && /Muat ulang/.test(r.error), 'GET updateMyProfile ditolak');
  r = call(e5, 'GET', { action: 'getUsers', token: tk5 });
  ok(r.ok, 'aksi tanpa password (getUsers) lewat GET tetap jalan');

  // 14. sec5: gangguan sesaat Google tidak boleh menendang pengguna
  const e7 = makeEnv([['U9', 'ast', 'asisten1', 'Asisten', 'asisten', '', 'YA']]);
  const login7 = () => call(e7, 'POST', { action: 'login', username: 'ast', password: 'asisten1' });
  e7.__openGagal = 2;
  r = login7();
  ok(r.ok && r.data.token, 'login tetap berhasil walau Google 2x gagal membuka spreadsheet');
  const t7 = (r.data && r.data.token) || 'tidak-ada';
  ok(e7.__book.Sesi.some(x => x[0] === t7), 'sesi benar-benar tercatat di sheet Sesi');
  e7.__openGagal = 2;
  r = call(e7, 'POST', { action: 'getUsers', token: t7 });
  ok(!/Sesi tidak valid/.test(r.error || ''), 'gangguan sesaat saat memakai aplikasi tidak dianggap sesi habis');
  e7.__openGagal = 99;
  r = call(e7, 'POST', { action: 'getUsers', token: 'x' + t7 });
  ok(!r.ok && /gangguan sesaat/.test(r.error) && /penyimpanan/.test(r.error) && !/izin/.test(r.error), 'galat "izin" Google diganti pesan jelas: ' + r.error);
  e7.__openGagal = 99; e7.__aktifBisa = true;
  for (const k in e7.__cache) delete e7.__cache[k];
  r = call(e7, 'POST', { action: 'getUsers', token: t7 });
  ok(!/gangguan|izin/.test(r.error || ''), 'openById terus gagal → jalur cadangan (Sheet tempat skrip menempel) dipakai');
  e7.__openGagal = 0; e7.__aktifBisa = false;
  e7.__appendGagal = 99;
  r = login7();
  ok(!r.ok && !(r.data && r.data.token), 'sesi gagal dicatat → login GAGAL dengan pesan, bukan token palsu yang nanti ditolak');
  e7.__appendGagal = 0;
  // sesi baru belum terbaca oleh permintaan berikutnya
  const t8 = ((login7().data) || {}).token || 'tidak-ada';
  e7.__sesiBasi = 1;
  r = call(e7, 'POST', { action: 'getUsers', token: t8 });
  ok(!/Sesi tidak valid/.test(r.error || ''), 'permintaan pertama setelah login tidak ditolak walau Sheet belum terbaca terbaru');
  for (const k in e7.__cache) delete e7.__cache[k];
  e7.__sesiBasi = 1;
  r = call(e7, 'POST', { action: 'getUsers', token: t8 });
  ok(!/Sesi tidak valid/.test(r.error || ''), 'tanpa cache pun, server membaca ulang sekali sebelum menolak sesi');
  r = call(e7, 'POST', { action: 'getUsers', token: 'palsu' });
  ok(/Sesi tidak valid/.test(r.error || ''), 'token palsu tetap ditolak');

  // 15. LPDH: identitas per dapur + data harian
  const e8 = makeEnv([
    ['U1', 'adm', 'passwd1', 'Admin', 'admin', '', 'YA'], ['U2', 'akn', 'passwd2', 'Akuntan', 'akuntan', 'D001', 'YA'],
    ['U3', 'pic', 'passwd3', 'PIC', 'pic', 'D001', 'YA'], ['U4', 'yay', 'passwd4', 'Yayasan', 'yayasan', '', 'YA'], ['U5', 'ast', 'passwd5', 'Ast', 'asisten', '', 'YA']]);
  const pw8 = { adm: 'passwd1', akn: 'passwd2', pic: 'passwd3', yay: 'passwd4', ast: 'passwd5' };
  const tk8 = u => call(e8, 'POST', { action: 'login', username: u, password: pw8[u] }).data.token;
  const B8 = e8.__book;
  B8.Dapur.push(['D002', 'SPPG Dua', '', 'S2']);
  B8.Setup[1] = ['P1', 'D001', 1, '2026-10-01', '2026-10-31', 100, 5000000, 200000, 'AKTIF'];
  B8.VATopup = [['id', 'dapur', 'periode', 'tanggal', 'jumlah', 'ket'], ['V1', 'D001', 'P1', '2026-10-05', 1000000, 'TU 1'], ['V2', 'D001', 'P1', '2026-10-10', 700000, 'TU 2']];
  B8.PengajuanItem = [['h'], ['IT1', 'PA1', 'D001', 'P1', 1, 'Bahan Baku', 'Semua Kategori', 'Beras', 300000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'TEREALISASI']];
  const tx = (id, tgl, nb, jenis, kat, ur, riil, link, dapur) => [id, dapur || 'D001', tgl, nb, jenis, kat, ur, 'VA', riil, riil, 'https://drive.google.com/x' + id, '', 'U2', 'P1', link || ''];
  B8.Transaksi = [['h'],
    tx('T1', '2026-10-09', 'NB-0', 'Operasional', 'Listrik', 'Listrik', 100000),
    tx('T2', '2026-10-10', '01-2026', 'Bahan Baku', 'Semua Kategori', 'Beras', 300000, 'IT1'),
    tx('T3', '2026-10-10', 'NB-ADM', 'Operasional', 'Biaya Admin Bank', 'Admin', 6500, 'ADMIN:IT1'),
    tx('T4', '2026-10-10', 'NB-9', 'Bahan Baku', 'Semua Kategori', 'Dapur lain', 999, '', 'D002'),
    tx('T5', '2026-10-11', 'NB-5', 'Operasional', 'Gas', 'Gas', 50000)];
  const lp = (u, extra) => call(e8, 'POST', Object.assign({ action: 'getDataLPDH', token: tk8(u), dapur: 'D001', tanggal: '2026-10-10' }, extra || {}));
  r = lp('adm');
  ok(r.ok, 'admin bisa membuat data LPDH: ' + (r.error || ''));
  ok(r.ok && r.data.saldoAwal === 5000000 + 200000 + 1000000 - 100000, 'saldo awal = saldo VA + kas kecil awal + top up sebelum hari ini − pengeluaran sebelum hari ini (' + (r.data && r.data.saldoAwal) + ')');
  ok(r.ok && r.data.transaksi.map(t => t.id).join(',') === 'T2,T3', 'hanya transaksi dapur ini bertanggal hari itu');
  ok(r.ok && r.data.transaksi[0].pemasok === 'Toko A' && r.data.transaksi[1].pemasok === 'BCA', 'pemasok dari pengajuan; biaya admin → bank');
  ok(r.ok && r.data.topups.length === 1 && r.data.topups[0].jumlah === 700000, 'top up hari itu ikut');
  ok(r.ok && r.data.transaksi[0].no_bukti === '01-2026', 'nomor bukti dibaca sesuai tampilan sheet');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('akn'), dapur: 'D002', tanggal: '2026-10-10' });
  ok(r.ok && r.data.dapur.id === 'D001', 'akuntan dipaksa ke dapurnya sendiri walau minta dapur lain');
  ok(!lp('ast').ok, 'asisten tidak bisa membuat LPDH');
  ok(!lp('adm', { tanggal: '2026-12-01' }).ok, 'tanggal di luar periode ditolak');
  // identitas
  const idt = { dapur: 'D001', id_sppg: '32.04.01.0001', yayasan: 'Yayasan X', no_va: '0012345678901234', pengawas_nama: 'Peng', pengawas_nik: '3204000000000001', kepala_nip: '199001012026011001', wakil_nik: '3204000000000002' };
  r = call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('akn') }, idt));
  ok(r.ok, 'akuntan menyimpan identitas LPDH (sheet dibuat otomatis): ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'getIdentitasLPDH', token: tk8('pic') });
  ok(r.ok && r.data.no_va === '0012345678901234' && r.data.pengawas_nik === '3204000000000001', 'angka panjang (VA/NIK) tersimpan utuh sebagai teks, nol di depan tidak hilang');
  r = call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('pic') }, idt, { kepala_nip: '123' }));
  ok(!r.ok && /NIP/.test(r.error), 'NIP bukan 18 digit ditolak');
  r = call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('pic') }, idt, { yayasan: 'Yayasan Y' }));
  ok(r.ok && B8.IdentitasLPDH.length === 2 && B8.IdentitasLPDH[1][6] === 'Yayasan Y', 'simpan ulang memperbarui baris yang sama (tidak dobel)');
  ok(!call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('yay') }, idt)).ok, 'yayasan hanya bisa melihat, tidak mengubah');
  ok(lp('adm').data.identitas.yayasan === 'Yayasan Y', 'data LPDH membawa identitas');
  // nomor bukti tipe tanggal disimpan sebagai teks
  ok(e8.teksSel('01-2026') === "'01-2026" && e8.teksSel('1/10') === "'1/10" && e8.teksSel('NT-001') === 'NT-001' && e8.teksSel('') === '', 'nomor bukti mirip tanggal/angka disimpan sebagai teks');

  console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
  process.exit(fails ? 1 : 0);
})();
