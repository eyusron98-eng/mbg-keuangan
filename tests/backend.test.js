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
      sandbox.__baca[name] = (sandbox.__baca[name] || 0) + 1;
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
      get: k => (k in cacheStore ? cacheStore[k] : null),
      getAll: ks => { const o = {}; (ks || []).forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
      put: (k, v) => { if (String(v).length > 100000) throw new Error('Argument too large: value'); cacheStore[k] = v; },
      putAll: map => { Object.keys(map || {}).forEach(k => { if (String(map[k]).length > 100000) throw new Error('Argument too large: value'); cacheStore[k] = map[k]; }); },
      remove: k => { delete cacheStore[k]; }, removeAll: ks => ks.forEach(k => delete cacheStore[k]) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, bytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes.map(b => b & 255))).digest()).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (s, mime, nama) => ({ getBytes: () => Array.from(Buffer.from(s, 'utf8')).map(b => (b > 127 ? b - 256 : b)),
        getAs: () => ({ _html: s, setName(n) { this._nama = n; return this; } }) }),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), base64Encode: b => Buffer.from(b.map(x => x & 255)).toString('base64'),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      getUuid: () => crypto.randomUUID(),
      sleep() {},
      formatDate: (d, tz, f) => { const x = new Date(d); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', x.getFullYear()).replace('MM', p(x.getMonth() + 1)).replace('dd', p(x.getDate())).replace('HH', p(x.getHours())).replace('mm', p(x.getMinutes())).replace('ss', p(x.getSeconds())); },
    },
    Date, JSON, Math, Number, String, parseInt, Intl, Array, Object, Error,
    __kuitansi: [], __driveGagal: false, __props: {}, __files: {}, __baca: {}, __nProps: 0, __nDrive: 0,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (sandbox.__nProps++, k in sandbox.__props ? sandbox.__props[k] : null), setProperty: (k, v) => { sandbox.__props[k] = v; },
      deleteProperty: k => { delete sandbox.__props[k]; }, getProperties: () => (sandbox.__nProps++, Object.assign({}, sandbox.__props)) }) },
    DriveApp: { Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      createFile: blob => { const id = 'F' + (Object.keys(sandbox.__files).length + 1); sandbox.__files[id] = { trashed: false };
        return { getId: () => id, setSharing() {}, getUrl: () => 'https://drive/' + id }; },
      getFileById: id => (sandbox.__nDrive++, { setTrashed: v => { if (sandbox.__files[id]) sandbox.__files[id].trashed = v; },
        getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [1, 2, 3] }) }),
      getFolderById: () => ({ createFile: blob => { if (sandbox.__driveGagal) throw new Error('Kesalahan layanan: Drive');
        sandbox.__kuitansi.push(blob); const n = sandbox.__kuitansi.length; return { setSharing() {}, getUrl: () => 'https://drive.google.com/kuitansi/' + n, getId: () => 'K' + n }; } }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(transform ? transform(fs.readFileSync(FILE, 'utf8')) : fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'Code.gs' });
  sandbox.__today = '2026-10-10';
  vm.runInContext('const _origTodayStr = todayStr; todayStr = function() { return typeof __today === "string" && __today ? __today : _origTodayStr(); };', sandbox);
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
  ok(call(env, 'GET', { action: 'ping' }).version === 'v6-ba-sec32', 'ping menampilkan versi baru');

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
  items[0].rincian = [{ nama: 'Beras', kategori: 'Karbohidrat', volume: 50, satuan: 'kg', harga: 12000 }];
  items[0].nota_url = 'https://drive.google.com/nota-beras';
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
  const it2 = [{ jenis: j2, kategori: JK2[j2][0], uraian: 'Beras', nominal: 100000, penerima_id: 'pn1', nota_url: 'https://drive.google.com/n2', rincian: [{ nama: 'Beras', kategori: 'Karbohidrat', volume: 10, satuan: 'kg', harga: 10000 }] }];
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

  // 11b. Pengajuan yang tertinggal (masih menunggu) di periode yang sudah ditutup: tampil di tab Menunggu & hanya bisa ditolak
  e6.__book.Pengajuan.push(['PAGAN', 'BA-PA/S1/2026/09/002', 'D001', 'P0', '2026-09-11', 'MENUNGGU', new Date(), 'U3', '', '']);
  e6.__book.PengajuanItem.push(['PAGAN-1', 'PAGAN', 'D001', 'P0', 1, 'Bahan Baku', 'x', 'Ganda', 70000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DIAJUKAN', '', 1, '', '', '', new Date(), new Date()]);
  r = call(e6, 'POST', { action: 'getPengajuan', token: tok6('pic1'), scope: 'ALL', filter: 'menunggu' });
  const gan = r.ok && r.data.pengajuan.find(h => h.id === 'PAGAN');
  ok(gan && gan.periode_tutup === true, 'tab Menunggu menampilkan pengajuan menunggu dari periode ditutup (periode_tutup)');
  ok(r.ok && r.data.pengajuan.every(h => h.status === 'MENUNGGU'), 'tab Menunggu hanya berisi yang menunggu');
  ok(!call(e6, 'POST', { action: 'getPengajuan', token: tok6('pic1'), scope: 'ALL' }).data.pengajuan.some(h => h.id === 'PAGAN'), 'tab periode aktif tidak ikut menampilkan periode ditutup');
  const decG = (st, cat) => call(e6, 'POST', { action: 'decidePengajuan', token: tok6('pic1'), pengajuan_id: 'PAGAN', keputusan: [{ item_id: 'PAGAN-1', status: st, catatan: cat || '' }] });
  r = decG('DISETUJUI'); ok(!r.ok && /ditutup/.test(r.error), 'periode ditutup: tidak bisa disetujui (' + r.error + ')');
  r = decG('REVISI', 'perbaiki'); ok(!r.ok && /hanya bisa ditolak/.test(r.error), 'periode ditutup: tidak bisa direvisi');
  r = decG('DITOLAK', 'Pengajuan ganda'); ok(r.ok, 'periode ditutup: baris tertinggal bisa ditolak (' + (r.error || 'ok') + ')');
  ok(e6.__book.PengajuanItem.find(x => x[0] === 'PAGAN-1')[14] === 'DITOLAK', 'status baris menjadi DITOLAK');
  ok(e6.__book.Pengajuan.find(x => x[0] === 'PAGAN')[5] === 'SELESAI', 'status header menjadi SELESAI');

  // 12. getPenandatangan: nama & TTD akuntan dapur, Perwakilan Mitra/Yayasan, dan Kepala SPPG dari LPDH
  call(e6, 'POST', { action: 'saveIdentitasLPDH', token: tok6('adm'), dapur: 'D001', kepala_nama: 'Drs. Hendra Kepala', wakil_nama: 'H. Ahmad Yayasan' });
  call(e6, 'POST', { action: 'saveTtd', token: tok6('akn'), fileData: 'data:image/png;base64,QUFB' });
  call(e6, 'POST', { action: 'saveTtd', token: tok6('adm'), untuk: 'wakil', dapur: 'D001', fileData: 'data:image/png;base64,QkJC' });
  call(e6, 'POST', { action: 'saveTtd', token: tok6('adm'), untuk: 'kepala', dapur: 'D001', fileData: 'data:image/png;base64,Q0ND' });
  const pt = (u, d) => call(e6, 'POST', { action: 'getPenandatangan', token: tok6(u), dapur: d });
  r = pt('adm', 'D001');
  ok(r.ok && r.data.akuntan === 'Akuntan' && r.data.wakil === 'H. Ahmad Yayasan' && r.data.kepala === 'Drs. Hendra Kepala', 'admin mendapat nama akuntan, wakil yayasan & kepala SPPG D001: ' + JSON.stringify(r.data));
  ok(r.data.ttd && r.data.ttd.akuntan === 'data:image/png;base64,QUFB' && r.data.ttd.wakil === 'data:image/png;base64,QkJC' && r.data.ttd.kepala === 'data:image/png;base64,Q0ND', 'getPenandatangan menyertakan TTD akuntan, wakil yayasan & kepala SPPG dari LPDH');
  ok(Object.keys(r.data).join(',') === 'akuntan,wakil,kepala,ttd', 'hanya nama & ttd penanda tangan yang dikirim (tanpa password/NIK/data lain)');
  r = pt('yay', 'D001'); ok(r.ok && r.data.akuntan === 'Akuntan' && r.data.wakil === 'H. Ahmad Yayasan', 'yayasan mendapat nama penanda tangan');
  r = pt('pic1', 'D001'); ok(r.ok && r.data.akuntan === 'Akuntan' && r.data.kepala === 'Drs. Hendra Kepala', 'PIC dapur sendiri mendapat nama penanda tangan');
  r = pt('pic2', 'D001'); ok(r.ok && r.data.akuntan === '' && r.data.wakil === '' && r.data.kepala === '', 'PIC dapur lain: dapur dipaksa ke dapurnya sendiri (D002, tanpa akuntan) → kosong, bukan D001');
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
  B8.Transaksi[1][8] = 80000; B8.Transaksi[5][8] = 40000;   // realisasi aktual < anggaran: LPDH tetap pakai anggaran
  const lp = (u, extra) => call(e8, 'POST', Object.assign({ action: 'getDataLPDH', token: tk8(u), dapur: 'D001', tanggal: '2026-10-10' }, extra || {}));
  r = lp('adm');
  ok(r.ok, 'admin bisa membuat data LPDH: ' + (r.error || ''));
  ok(r.ok && r.data.saldoAwal === 5000000 + 200000 + 1000000 - 100000, 'saldo awal = saldo VA + kas kecil awal + top up sebelum hari ini − pengeluaran sebelum hari ini (' + (r.data && r.data.saldoAwal) + ')');
  ok(r.ok && r.data.transaksi.map(t => t.id).join(',') === 'T2,T3', 'hanya transaksi dapur ini bertanggal hari itu');
  ok(r.ok && r.data.transaksi[0].pemasok === 'Toko A' && r.data.transaksi[1].pemasok === 'BCA', 'pemasok dari pengajuan; biaya admin → bank');
  ok(r.ok && r.data.topups.length === 1 && r.data.topups[0].jumlah === 700000, 'top up hari itu ikut');
  { const r11 = lp('adm', { tanggal: '2026-10-11' }); const g = r11.ok && r11.data.transaksi.find(t => t.id === 'T5');
    ok(g && g.riil === 50000 && g.aktual === 40000, 'LPDH memakai anggaran pengajuan (50.000), bukan realisasi aktual (40.000)'); }
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
  // saldo per komponen bersambung
  r = lp('adm');
  const kp = r.data.komponen;
  ok(kp.awal.reduce((a, b) => a + b) === r.data.saldoAwal, 'saldo awal 3 komponen = saldo awal total (' + kp.awal.join('/') + ')');
  ok(kp.awal.every(x => x >= 0), 'tidak ada komponen negatif');
  ok(kp.topups.length === 1 && kp.topups[0].bagi.reduce((a, b) => a + b) === 700000, 'top up hari itu dibagi ke komponen, jumlah tetap');
  // hari dengan belanja Operasional melebihi jatahnya dan tanpa top up → digeser, dicatat
  B8.Transaksi.push(tx('T6', '2026-10-12', 'NB-6', 'Operasional', 'Sewa Kendaraan', 'Sewa', 5500000));
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-12' });
  const k2 = r.data.komponen;
  ok(k2.geser.length > 0 && k2.geser.every(g => g.ke === 1), 'kekurangan Operasional ditutup pergeseran dari komponen lain (' + JSON.stringify(k2.geser) + ')');
  ok(k2.awal[1] >= 5500000 && k2.awal.every(x => x >= 0) && k2.awal.reduce((a, b) => a + b) === r.data.saldoAwal, 'setelah pergeseran: Operasional cukup, tidak ada yang negatif, total tetap');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-13' });
  ok(r.data.komponen.awal[1] === 0 && r.data.komponen.awal.reduce((a, b) => a + b) === r.data.saldoAwal, 'hari berikutnya melanjutkan saldo komponen kemarin (bersambung)');

  // nomor bukti: "-" ditolak, kembar ditolak, kosong → otomatis unik
  const tkA = tk8('akn');
  const itemBaru = (id) => { B8.PengajuanItem.push([id, 'PA1', 'D001', 'P1', 2, 'Bahan Baku', 'Semua Kategori', 'Telur', 100000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI']); };
  const real = (id, nb) => call(e8, 'POST', { action: 'realisasiItem', token: tkA, item_id: id, tanggal: '2026-10-14', no_bukti: nb, bukti_url: 'https://drive.google.com/z' });
  itemBaru('IT2'); itemBaru('IT3'); itemBaru('IT4'); itemBaru('IT5'); itemBaru('IT6');
  r = real('IT2', '-'); ok(!r.ok && /tidak boleh/.test(r.error), 'nomor bukti "-" ditolak');
  r = real('IT2', '01-2026'); ok(!r.ok && /sudah dipakai/.test(r.error), 'nomor bukti yang sudah dipakai ditolak (termasuk data lama)');
  r = real('IT2', ' nb-5 '); ok(!r.ok && /sudah dipakai/.test(r.error), 'pembanding tidak peka huruf besar/kecil & spasi');
  r = real('IT2', ''); ok(r.ok && r.data.no_bukti === 'S1-20261014-001', 'kosong → nomor otomatis: ' + (r.data && r.data.no_bukti || r.error));
  r = real('IT3', ''); ok(r.ok && r.data.no_bukti === 'S1-20261014-002', 'nomor otomatis berikutnya berurutan: ' + (r.data && r.data.no_bukti));
  r = real('IT4', 'NT-77'); ok(r.ok && r.data.no_bukti === 'NT-77', 'nomor unik diterima apa adanya');
  r = real('IT5', '01-2026-TOKOB'); ok(r.ok, 'nomor kembar + kode toko diterima');
  // edit transaksi lama yang nomornya kembar: bagian lain tetap bisa diedit
  B8.Transaksi.push(tx('T7', '2026-10-14', '01-2026', 'Operasional', 'Gas', 'Gas lama', 1000));
  r = call(e8, 'POST', { action: 'updateTransaksi', token: tkA, id: 'T7', no_bukti: '01-2026', tanggal: '2026-10-14', riil: 2000 });
  ok(r.ok, 'transaksi lama dengan nomor kembar tetap bisa diedit selama nomornya tidak diubah: ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'updateTransaksi', token: tkA, id: 'T7', no_bukti: 'NT-77' });
  ok(!r.ok && /sudah dipakai/.test(r.error), 'mengubah nomor ke nomor yang sudah dipakai ditolak');
  r = call(e8, 'POST', { action: 'addTransaksi', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-14', jenis: 'Operasional', kategori: 'Gas', uraian: 'x', sumber: 'VA', riil: 1, no_bukti: 'NT-999', alasan: 'uji' });
  ok(!r.ok && /Input Darurat telah dihapus/i.test(r.error), 'Input Darurat (addTransaksi) sudah dinonaktifkan');

  // ── Tahap 2 ──
  // rincian per bahan wajib & harus sama dengan nominal
  const tkAst = tk8('ast');
  const pa = (items) => call(e8, 'POST', { action: 'createPengajuan', token: tkAst, dapur: 'D001', tanggal: '2026-10-15', items });
  const bb = (extra) => Object.assign({ jenis: 'Bahan Baku', kategori: 'Semua Kategori', uraian: 'Belanja sayur', nominal: 150000, penerima_id: 'pn1', nota_url: 'https://drive.google.com/nota-x' }, extra);
  r = pa([bb({})]); ok(!r.ok && /Rincian bahan wajib/.test(r.error), 'Bahan Baku tanpa rincian ditolak');
  r = pa([bb({ rincian: [{ nama: 'Wortel', kategori: 'Sayuran', volume: 10, satuan: 'kg', harga: 10000 }] })]);
  ok(!r.ok && /harus sama dengan nominal/.test(r.error), 'jumlah rincian ≠ nominal ditolak');
  r = pa([bb({ rincian: [{ nama: 'Wortel', kategori: 'Sayur', volume: 10, satuan: 'kg', harga: 15000 }] })]);
  ok(!r.ok && /kategori bahan/.test(r.error), 'kategori bahan di luar daftar PPK ditolak');
  r = pa([bb({ nota_url: 'http://x', rincian: [{ nama: 'Wortel', kategori: 'Sayuran', volume: 10, satuan: 'kg', harga: 15000 }] })]);
  ok(!r.ok && /link nota/.test(r.error), 'link nota bukan https ditolak');
  r = pa([bb({ nota_url: 'https://drive.google.com/nota1', nota_no: 'NT-SAYUR', rincian: [{ nama: 'Wortel', kategori: 'Sayuran', volume: 2.5, satuan: 'kg', harga: 20000 }, { nama: 'Kol', kategori: 'Sayuran', volume: 5, satuan: 'kg', harga: 20000 }] })]);
  ok(r.ok, 'asisten mengajukan Bahan Baku dengan rincian desimal + nota: ' + (r.error || ''));
  const itR = B8.PengajuanItem[B8.PengajuanItem.length - 1];
  ok(JSON.parse(itR[22]).length === 2 && itR[23] === 'https://drive.google.com/nota1', 'rincian & nota tersimpan di baris pengajuan');
  // disetujui → otomatis terealisasi & LPDH membawa rincian & nota
  r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('adm'), pengajuan_id: r.data.id, keputusan: [{ item_id: itR[0], status: 'DISETUJUI' }] });
  ok(r.ok && itR[14] === 'TEREALISASI', 'disetujui → Bahan Baku berrincian otomatis terealisasi: ' + (r.error || itR[14]));
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-15' });
  const txR = r.data.transaksi.find(t => t.no_bukti === 'NT-SAYUR');
  ok(txR && txR.rincian.length === 2 && txR.rincian[0].volume === 2.5 && txR.nota_url === 'https://drive.google.com/nota1', 'data LPDH membawa rincian bahan & link nota');
  // edit item: rincian tetap wajib
  r = pa([bb({ uraian: 'Belanja buah', rincian: [{ nama: 'Pisang', kategori: 'Buah', volume: 10, satuan: 'sisir', harga: 15000 }] })]);
  const itE = B8.PengajuanItem[B8.PengajuanItem.length - 1][0];
  r = call(e8, 'POST', { action: 'updatePengajuanItem', token: tkAst, item_id: itE, jenis: 'Bahan Baku', kategori: 'Semua Kategori', uraian: 'Belanja buah', nominal: 200000, penerima_id: 'pn1',
    rincian: [{ nama: 'Pisang', kategori: 'Buah', volume: 10, satuan: 'sisir', harga: 20000 }] });
  ok(r.ok && JSON.parse(B8.PengajuanItem[B8.PengajuanItem.length - 1][22])[0].harga === 20000, 'edit baris memperbarui rincian: ' + (r.error || ''));

  // data harian PIC: simpan, salin ke hari berikut tanpa BAST
  const harian = { pm: [{ kode: 'KS-02', target: 650, distribusi: 650, diterima: 640, tidak: 10, alasan: 'PM tidak hadir', bnba: 'Ya', bast: 'BAST-01', link: 'https://cloud/bast1' }],
    produksi: { total: 660, organoleptik: 3, sampel: 3, tidak_terdistribusi: 4, buffer: 0 }, syarat: { kontaminasi: 'Tidak', verifikasi: 'Ya' } };
  r = call(e8, 'POST', { action: 'saveHarianLPDH', token: tk8('pic'), tanggal: '2026-10-15', data: harian });
  ok(r.ok, 'PIC menyimpan data harian: ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'saveHarianLPDH', token: tk8('pic'), tanggal: '2026-10-15', data: Object.assign({}, harian, { pm: [{ kode: 'KS-02', target: -1 }] }) });
  ok(!r.ok, 'angka negatif ditolak');
  r = call(e8, 'POST', { action: 'saveHarianLPDH', token: tk8('pic'), tanggal: '2026-10-15', data: Object.assign({}, harian, { pm: [{ kode: 'KS-02', link: 'cloud/x' }] }) });
  ok(!r.ok && /https/.test(r.error), 'link BAST tanpa https ditolak');
  ok(!call(e8, 'POST', { action: 'saveHarianLPDH', token: tkAst, dapur: 'D001', tanggal: '2026-10-15', data: harian }).ok, 'asisten tidak bisa mengisi data harian');
  r = call(e8, 'POST', { action: 'getHarianLPDH', token: tk8('pic'), tanggal: '2026-10-16' });
  const ks2 = r.data.data.pm.find(x => x.kode === 'KS-02');
  ok(/disalin dari 2026-10-15/.test(r.data.sumber) && ks2.target === 650 && ks2.diterima === 640 && ks2.bast === '' && ks2.link === '', 'hari berikutnya: angka disalin, nomor & link BAST dikosongkan');
  r = call(e8, 'POST', { action: 'getHarianLPDH', token: tk8('pic'), tanggal: '2026-10-15' });
  ok(r.data.sumber === 'tersimpan' && r.data.data.pm.length === 10, 'tanggal yang sudah diisi: data tersimpan (10 kelompok)');
  call(e8, 'POST', { action: 'saveHarianLPDH', token: tk8('pic'), tanggal: '2026-10-15', data: Object.assign({}, harian, { produksi: { total: 700 } }) });
  ok(B8.LPDHHarian.length === 2, 'simpan ulang tanggal yang sama tidak menambah baris');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-15' });
  ok(r.data.harian && r.data.harian.produksi.total === 700, 'data LPDH membawa data harian tanggal itu');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-16' });
  ok(r.ok && r.data.harian === null, 'LPDH tanggal tanpa isian harian tidak memakai data hari lain');

  // daftar relawan per transaksi honor
  B8.Transaksi.push(tx('TH1', '2026-10-16', 'HN-1', 'Operasional', 'Gaji/honor relawan pekerja SPPG', 'Honor relawan 1-10 Okt', 1800000));
  const rel = [{ nama: 'Ani', tugas: 'Juru masak', hari: 10, upah: 100000 }, { nama: 'Budi', tugas: 'Pengemudi', hari: 10, upah: 80000, metode: 'Tunai' }];
  r = call(e8, 'POST', { action: 'getRelawanBayar', token: tk8('pic'), transaksi_id: 'TH1' });
  ok(r.ok && r.data.sumber === 'baru' && r.data.total === 1800000, 'daftar relawan pertama: kosong');
  r = call(e8, 'POST', { action: 'saveRelawanBayar', token: tk8('pic'), transaksi_id: 'TH1', rows: rel.slice(0, 1) });
  ok(!r.ok && /≠ nilai transaksi/.test(r.error), 'total daftar ≠ nilai transaksi ditolak');
  r = call(e8, 'POST', { action: 'saveRelawanBayar', token: tk8('pic'), transaksi_id: 'TH1', rows: rel });
  ok(r.ok, 'daftar relawan disimpan: ' + (r.error || ''));
  ok(!call(e8, 'POST', { action: 'saveRelawanBayar', token: tk8('pic'), transaksi_id: 'T5', rows: rel }).ok, 'transaksi bukan honor relawan ditolak');
  B8.Transaksi.push(tx('TH2', '2026-10-26', 'HN-2', 'Operasional', 'Gaji/honor relawan pekerja SPPG', 'Honor relawan 11-20 Okt', 1800000));
  r = call(e8, 'POST', { action: 'getRelawanBayar', token: tk8('pic'), transaksi_id: 'TH2' });
  ok(/disalin/.test(r.data.sumber) && r.data.rows.length === 2 && r.data.rows[1].metode === 'Tunai', 'pembayaran berikutnya: daftar disalin dari yang terakhir');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-16' });
  const th = r.data.transaksi.find(t => t.id === 'TH1');
  ok(th && th.relawan && th.relawan.length === 2 && th.relawan[0].nama === 'Ani', 'data LPDH membawa daftar relawan transaksi honor');

  // ── Kelengkapan dokumen LPDH ──
  r = call(e8, 'POST', { action: 'saveTopupLPDH', token: tkA, id: 'V2', no_sp2d: 'SP2D-001/2026', no_kuitansi: 'KW-TU-1', bukti_url: 'https://cloud/tu1' });
  ok(r.ok, 'akuntan melengkapi SP2D/kuitansi/link top up: ' + (r.error || ''));
  ok(!call(e8, 'POST', { action: 'saveTopupLPDH', token: tkA, id: 'V2', bukti_url: 'cloud/x' }).ok, 'link bukti terima tanpa https ditolak');
  ok(!call(e8, 'POST', { action: 'saveTopupLPDH', token: tk8('pic'), id: 'V2', no_sp2d: 'x' }).ok, 'PIC tidak mengisi dokumen keuangan');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-10' });
  ok(r.data.topups[0].no_sp2d === 'SP2D-001/2026' && r.data.komponen.topups[0].no_kuitansi === 'KW-TU-1' && r.data.komponen.topups[0].bukti_url === 'https://cloud/tu1', 'data LPDH membawa dokumen top up');
  r = call(e8, 'POST', { action: 'addVATopup', token: tkA, dapur: 'D001', tanggal: '2026-10-20', jumlah: 500000, keterangan: 'TU 3', no_sp2d: 'SP2D-002', no_kuitansi: '01-2026', bukti_url: 'https://cloud/tu3' });
  const vRow = B8.VATopup[B8.VATopup.length - 1];
  ok(r.ok && vRow[8] === 'SP2D-002' && vRow[9] === '01-2026' && vRow[10] === 'https://cloud/tu3', 'top up baru langsung menyimpan SP2D, kuitansi (sebagai teks), link');
  B8.Transaksi.push(tx('TI1', '2026-10-17', 'INS-1', 'Fasilitas SPPG', 'Sewa Gedung', 'Insentif 1-10 Okt', 5000000));
  r = call(e8, 'POST', { action: 'saveInsentifLPDH', token: tkA, transaksi_id: 'TI1', no_ppk: 'PPK/INS/2026/0101', nilai_ppk: 5000000, no_kuitansi: 'KW-INS-1', kuitansi_ttd: 'Ya', ref_va: 'TRX-1' });
  ok(r.ok, 'akuntan mengisi pernyataan PPK & kuitansi insentif: ' + (r.error || ''));
  ok(!call(e8, 'POST', { action: 'saveInsentifLPDH', token: tkA, transaksi_id: 'T5', no_ppk: 'x' }).ok, 'transaksi bukan insentif ditolak');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-17' });
  const ti = r.data.transaksi.find(t => t.id === 'TI1');
  ok(ti.insentif.no_ppk === 'PPK/INS/2026/0101' && ti.insentif.nilai_ppk === 5000000 && ti.insentif.kuitansi_ttd === 'Ya', 'data LPDH membawa pernyataan PPK insentif');
  ok(r.data.saldoRekening === null, 'saldo rekening belum diisi → kosong (tidak diisi otomatis dari aplikasi)');
  r = call(e8, 'POST', { action: 'saveSaldoLPDH', token: tkA, tanggal: '2026-10-17', saldo_va: 1234567, penjelasan: 'kas kecil di tangan' });
  ok(r.ok, 'akuntan menyimpan saldo VA rekening: ' + (r.error || ''));
  ok(!call(e8, 'POST', { action: 'saveSaldoLPDH', token: tkA, tanggal: '2026-10-17', saldo_va: '' }).ok, 'saldo kosong ditolak');
  call(e8, 'POST', { action: 'saveSaldoLPDH', token: tkA, tanggal: '2026-10-17', saldo_va: 1234000, penjelasan: '' });
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-17' });
  ok(r.data.saldoRekening.saldo_va === 1234000 && B8.LPDHSaldo.length === 2, 'saldo rekening tersimpan & diperbarui (tidak dobel)');

  // ── Admin "bertindak sebagai" peran lain ──
  const tkAdm = tk8('adm');
  const sb = (peran, dapur, extra) => Object.assign({ token: tkAdm, sebagai: peran, sebagai_dapur: dapur || '' }, extra);
  r = call(e8, 'POST', sb('akuntan', 'D001', { action: 'getRealisasiList' }));
  ok(r.ok, 'admin sebagai akuntan D001 bisa membuka daftar realisasi: ' + (r.error || ''));
  ok(!call(e8, 'POST', { action: 'getRealisasiList', token: tkAdm }).ok, 'tanpa mode uji, admin tetap admin (realisasi khusus akuntan)');
  r = call(e8, 'POST', sb('akuntan', 'D001', { action: 'createPengajuan', tanggal: '2026-10-18', items: [{ jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas uji', nominal: 50000, rencana_riil: 48000, nota_url: 'https://drive.google.com/gas-uji', penerima_id: 'pn1' }] }));
  ok(r.ok, 'admin sebagai akuntan bisa membuat pengajuan: ' + (r.error || ''));
  const headUji = B8.Pengajuan[B8.Pengajuan.length - 1];
  ok(headUji[2] === 'D001' && headUji[7] === 'U1', 'pengajuan masuk dapur yang dipilih, tercatat atas nama admin (U1)');
  const itUji = B8.PengajuanItem[B8.PengajuanItem.length - 1][0];
  r = call(e8, 'POST', sb('pic', 'D002', { action: 'decidePengajuan', pengajuan_id: headUji[0], keputusan: [{ item_id: itUji, status: 'DISETUJUI' }] }));
  ok(!r.ok && /dapurnya sendiri/.test(r.error), 'sebagai PIC dapur lain: aturan PIC berlaku (ditolak)');
  r = call(e8, 'POST', sb('yayasan', '', { action: 'getIdentitasLPDH', dapur: 'D001' }));
  ok(r.ok, 'sebagai yayasan bisa melihat identitas LPDH');
  ok(!call(e8, 'POST', sb('yayasan', '', { action: 'saveIdentitasLPDH', dapur: 'D001', yayasan: 'X' })).ok, 'sebagai yayasan: aturan yayasan berlaku (tidak bisa mengubah)');
  r = call(e8, 'POST', sb('asisten', '', { action: 'getRealisasiList' }));
  ok(!r.ok, 'sebagai asisten: tidak bisa realisasi');
  ok(!call(e8, 'POST', sb('akuntan', '', { action: 'getRealisasiList' })).ok, 'peran berdapur tanpa dapur → tetap admin');
  ok(!call(e8, 'POST', sb('superuser', 'D001', { action: 'getRealisasiList' })).ok, 'peran tak dikenal diabaikan');
  // keamanan: non-admin tidak bisa menyamar
  r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('akn'), sebagai: 'yayasan', pengajuan_id: headUji[0], keputusan: [{ item_id: itUji, status: 'DISETUJUI' }] });
  ok(!r.ok && /tidak dapat menyetujui/.test(r.error), 'akuntan yang mengirim "sebagai yayasan" tetap akuntan (tidak bisa menyetujui)');
  r = call(e8, 'POST', { action: 'getRealisasiList', token: tk8('pic'), sebagai: 'akuntan', sebagai_dapur: 'D001' });
  ok(!r.ok, 'PIC yang mengirim "sebagai akuntan" ditolak');
  r = call(e8, 'POST', { action: 'getRealisasiList', token: tkAst, sebagai: 'akuntan', sebagai_dapur: 'D001' });
  ok(!r.ok && /Hanya akuntan/.test(r.error), 'asisten yang mengirim "sebagai akuntan" ditolak');

  // ── Otomatisasi LPDH lanjutan ──
  ok(lp('adm').data.identitas.bast_folder === '', 'identitas lama: kolom folder BAST (isinya tanggal) dibaca kosong');
  r = call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('akn') }, idt, { bast_folder: 'drive/bast' }));
  ok(!r.ok && /folder BAST/.test(r.error), 'link folder BAST tanpa https ditolak');
  r = call(e8, 'POST', Object.assign({ action: 'saveIdentitasLPDH', token: tk8('akn') }, idt, { bast_folder: 'https://drive.google.com/drive/folders/BAST' }));
  ok(r.ok && lp('adm').data.identitas.bast_folder === 'https://drive.google.com/drive/folders/BAST' && lp('adm').data.identitas.yayasan === 'Yayasan X', 'link folder BAST tersimpan, isian lain utuh');
  r = call(e8, 'POST', { action: 'saveTtdInsentif', token: tk8('pic'), transaksi_id: 'TI1', ttd_url: 'https://drive.google.com/ttd1' });
  ok(r.ok, 'PIC mengunggah kuitansi insentif bertanda tangan: ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-17' });
  const ti2 = r.data.transaksi.find(t => t.id === 'TI1');
  ok(ti2.insentif.ttd_url === 'https://drive.google.com/ttd1' && ti2.insentif.kuitansi_ttd === 'Ya' && ti2.insentif.no_ppk === 'PPK/INS/2026/0101', 'kuitansi ttd tersimpan tanpa menghapus pernyataan PPK');
  ok(r.data.ppkTerakhir === 'PPK/INS/2026/0101', 'nomor pernyataan PPK terakhir tersedia untuk dipakai lagi');
  ok(!call(e8, 'POST', { action: 'saveTtdInsentif', token: tkAst, transaksi_id: 'TI1', ttd_url: 'https://x' }).ok, 'asisten tidak bisa mengunggah kuitansi insentif');
  call(e8, 'POST', { action: 'saveInsentifLPDH', token: tkA, transaksi_id: 'TI1', no_ppk: 'PPK/INS/2026/0102', nilai_ppk: 5000000 });
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-17' });
  ok(r.data.transaksi.find(t => t.id === 'TI1').insentif.ttd_url === 'https://drive.google.com/ttd1', 'ubah pernyataan PPK tidak menghapus kuitansi bertanda tangan');

  // ── Relawan: daftar tetap, centang hadir ──
  B8.Transaksi.push(tx('TH3', '2026-10-27', 'HN-3', 'Operasional', 'Gaji/honor relawan pekerja SPPG', 'Honor 27 Okt', 240000));
  const daftar3 = [{ nama: 'Ani', tugas: 'Masak', hari: 1, upah: 120000, hadir: true }, { nama: 'Budi', tugas: 'Supir', hari: 1, upah: 120000, hadir: false }, { nama: 'Cici', tugas: 'Cuci', hari: 1, upah: 120000, hadir: true }];
  r = call(e8, 'POST', { action: 'saveRelawanBayar', token: tk8('pic'), transaksi_id: 'TH3', rows: daftar3 });
  ok(r.ok, 'simpan daftar dengan satu relawan tidak hadir (total = yang hadir saja): ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'saveRelawanBayar', token: tk8('pic'), transaksi_id: 'TH3', rows: daftar3.map(x => Object.assign({}, x, { hadir: false })) });
  ok(!r.ok && /dicentang hadir/.test(r.error), 'tidak ada yang hadir ditolak');
  r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('adm'), dapur: 'D001', tanggal: '2026-10-27' });
  const th3 = r.data.transaksi.find(t => t.id === 'TH3');
  ok(th3.relawan.length === 2 && !th3.relawan.some(x => x.nama === 'Budi'), 'LPDH hanya memuat relawan yang hadir');
  B8.Transaksi.push(tx('TH4', '2026-10-28', 'HN-4', 'Operasional', 'Gaji/honor relawan pekerja SPPG', 'Honor 28 Okt', 360000));
  r = call(e8, 'POST', { action: 'getRelawanBayar', token: tk8('pic'), transaksi_id: 'TH4' });
  ok(r.data.rows.length === 3 && r.data.rows.every(x => x.hadir === true), 'pembayaran berikutnya: daftar lengkap (termasuk yang kemarin absen) dicentang hadir semua');
  r = call(e8, 'POST', { action: 'getRelawanBayar', token: tk8('pic'), transaksi_id: 'TH3' });
  ok(r.data.rows.find(x => x.nama === 'Budi').hadir === false, 'daftar tersimpan mengingat siapa yang tidak hadir');

  // ── Realisasi sekali klik: nota pengajuan / kuitansi otomatis ──
  r = pa([bb({ nota_url: '', rincian: [{ nama: 'Wortel', kategori: 'Sayuran', volume: 10, satuan: 'kg', harga: 15000 }] })]);
  ok(!r.ok && /nota Bahan Baku wajib/.test(r.error), 'pengajuan Bahan Baku tanpa nota ditolak');
  const itemDisetujui = (id, jenis, kategori, nominal, extra) => { B8.PengajuanItem.push([id, 'PA1', 'D001', 'P1', 9, jenis, kategori, 'Uraian ' + id, nominal, 'pn1', 'Bu Siti', 'BRI', '0099', 'TIDAK', 'DISETUJUI',
    '', 1, '', '', '', '', '', (extra || {}).rincian || '', (extra || {}).nota || '', (extra || {}).notaNo || '']); };
  const real1 = (id, extra) => call(e8, 'POST', Object.assign({ action: 'realisasiItem', token: tkA, item_id: id, tanggal: '2026-10-19' }, extra || {}));
  itemDisetujui('K-BB', 'Bahan Baku', 'Semua Kategori', 300000, { nota: 'https://drive.google.com/nota-kbb' });
  r = real1('K-BB');
  const txBB = B8.Transaksi.find(t => t[14] === 'K-BB');
  ok(r.ok && r.data.bukti === 'nota' && txBB && txBB[10] === 'https://drive.google.com/nota-kbb', 'Bahan Baku: realisasi tanpa unggah memakai nota pengajuan: ' + (r.error || ''));
  itemDisetujui('K-BB0', 'Bahan Baku', 'Semua Kategori', 100000);
  r = real1('K-BB0');
  ok(!r.ok && /wajib diunggah/.test(r.error), 'Bahan Baku lama tanpa nota: tetap wajib unggah bukti');
  const nK = e8.__kuitansi.length;
  itemDisetujui('K-PIC', 'Operasional', 'Insentif Guru/PIC Sekolah', 1250000);
  r = real1('K-PIC', { riil: 1250000 });
  const txK = B8.Transaksi.find(t => t[14] === 'K-PIC');
  const html = (e8.__kuitansi[nK] || {})._html || '';
  ok(r.ok && r.data.bukti === 'kuitansi' && txK && /^https:\/\/drive\.google\.com\/kuitansi\//.test(txK[10]), 'Insentif PIC Sekolah: kuitansi PDF dibuat otomatis & ditautkan: ' + (r.error || ''));
  ok(/KUITANSI/.test(html) && /Bu Siti/.test(html) && /Satu juta dua ratus lima puluh ribu rupiah/.test(html) && html.includes(r.data.no_bukti) && /Rp/.test(html), 'isi kuitansi: penerima, nominal, terbilang, nomor bukti');
  ok(/Peng/.test(html), 'kuitansi memakai nama Pengawas Keuangan dari identitas LPDH');
  itemDisetujui('K-POS', 'Operasional', 'Insentif Kader Posyandu', 500000);
  itemDisetujui('K-SEWA', 'Operasional', 'Sewa Kendaraan', 750000);
  itemDisetujui('K-FAS', 'Fasilitas SPPG', 'Sewa Gedung', 5000000);
  ok(real1('K-POS', { riil: 500000 }).ok && real1('K-SEWA', { riil: 750000 }).ok && real1('K-FAS').ok, 'kader posyandu, sewa kendaraan, fasilitas ke Yayasan: sekali klik');
  itemDisetujui('K-GAS', 'Operasional', 'Gas', 200000);
  r = real1('K-GAS', { riil: 200000 });
  ok(!r.ok && /wajib diunggah/.test(r.error), 'operasional lain (Gas): tetap wajib unggah nota');
  r = real1('K-GAS', { riil: 200000, bukti_url: 'https://drive.google.com/gas' });
  ok(r.ok && r.data.bukti === 'unggah', 'operasional lain dengan unggahan berjalan seperti biasa');
  itemDisetujui('K-GAGAL', 'Operasional', 'Sewa Kendaraan', 300000);
  e8.__driveGagal = true;
  const nTx = B8.Transaksi.length;
  r = real1('K-GAGAL', { riil: 300000 });
  e8.__driveGagal = false;
  ok(!r.ok && /kuitansi/.test(r.error) && B8.Transaksi.length === nTx && B8.PengajuanItem.find(x => x[0] === 'K-GAGAL')[14] === 'DISETUJUI', 'Drive gagal → tidak ada transaksi setengah jadi, baris tetap Disetujui');
  // ── Barang Habis Pakai dipecah ke sub-kategori baris LPDH ──
  ok(e8.validateItemInput({ jenis: 'Operasional', kategori: 'Barang Habis Pakai', uraian: 'x', nominal: 1, penerima_id: 'p' }, { p: 1 }) === null, 'pengajuan baru: "Barang Habis Pakai" bisa dipilih lagi');
  ok(e8.validateItemInput({ jenis: 'Operasional', kategori: 'Biaya Rapat Koordinasi', uraian: 'x', nominal: 1, penerima_id: 'p' }, { p: 1 }) === null, 'kategori baru "Biaya Rapat Koordinasi" sah');
  itemDisetujui('K-BHP', 'Operasional', 'Barang Habis Pakai', 295000);
  itemDisetujui('K-BHP0', 'Operasional', 'Barang Habis Pakai', 100000);
  r = real1('K-BHP0', { riil: 100000, bukti_url: 'https://drive.google.com/bhp0' });
  ok(r.ok && B8.Transaksi.find(t => t[14] === 'K-BHP0')[5] === 'Barang Habis Pakai', 'realisasi Barang Habis Pakai tanpa sub-kategori: kategori tetap Barang Habis Pakai: ' + (r.error || ''));
  r = real1('K-BHP', { riil: 295000, bukti_url: 'https://drive.google.com/bhp', sub_kategori: 'Gas' });
  ok(!r.ok && /Sub-kategori harus/.test(r.error), 'sub-kategori di luar daftar ditolak');
  r = real1('K-BHP', { riil: 295000, bukti_url: 'https://drive.google.com/bhp', sub_kategori: 'ATK' });
  const txBHP = B8.Transaksi.find(t => t[14] === 'K-BHP');
  ok(r.ok && txBHP && txBHP[5] === 'ATK', 'realisasi Barang Habis Pakai tercatat dengan sub-kategori ATK: ' + (r.error || ''));
  txBHP[5] = 'Barang Habis Pakai';   // seolah transaksi lama
  r = call(e8, 'POST', { action: 'updateTransaksi', token: tkA, id: txBHP[0], kategori: 'Gas' });
  ok(!r.ok && /terkunci/.test(r.error) && txBHP[5] === 'Barang Habis Pakai', 'realisasi lama: kategori hanya bisa dipecah ke sub-kategori BHP');
  r = call(e8, 'POST', { action: 'updateTransaksi', token: tkA, id: txBHP[0], kategori: 'Alat Kebersihan' });
  ok(r.ok && txBHP[5] === 'Alat Kebersihan', 'realisasi lama Barang Habis Pakai bisa dipecah ke Alat Kebersihan: ' + (r.error || ''));
  r = call(e8, 'POST', { action: 'updateTransaksi', token: tkA, id: txBHP[0], kategori: 'ATK' });
  ok(!r.ok && txBHP[5] === 'Alat Kebersihan', 'setelah dipecah, kategori kembali terkunci');
  ok(e8.terbilang(0) === 'Nol rupiah' && e8.terbilang(1001000) === 'Satu juta seribu rupiah' && e8.terbilang(115000) === 'Seratus lima belas ribu rupiah' && e8.terbilang(2000000000) === 'Dua miliar rupiah', 'terbilang: ' + e8.terbilang(115000));

  // ── Nomor nota diisi saat pengajuan; realisasi tidak perlu mengisi nomor ──
  const rincNN = [{ nama: 'Telur', kategori: 'Protein hewani', volume: 10, satuan: 'kg', harga: 15000 }];
  r = pa([bb({ nota_no: '-', rincian: rincNN })]); ok(!r.ok && /tidak boleh/.test(r.error), 'nomor nota "-" ditolak saat pengajuan');
  r = pa([bb({ nota_no: '01-2026', rincian: rincNN })]); ok(!r.ok && /sudah dipakai transaksi/.test(r.error), 'nomor nota yang sudah dipakai transaksi ditolak saat pengajuan');
  r = pa([bb({ nota_no: 'NT-TELUR', rincian: rincNN }), bb({ uraian: 'b2', nota_no: 'nt-telur', rincian: rincNN })]); ok(!r.ok && /dua kali/.test(r.error), 'nomor nota kembar dalam satu pengajuan ditolak');
  r = pa([bb({ nota_no: 'NT-TELUR', rincian: rincNN })]); ok(r.ok, 'nomor nota unik diterima: ' + (r.error || ''));
  const itNN = B8.PengajuanItem[B8.PengajuanItem.length - 1];
  ok(itNN[24] === 'NT-TELUR', 'nomor nota tersimpan di baris pengajuan');
  r = pa([bb({ uraian: 'lain', nota_no: 'NT-TELUR ', rincian: rincNN })]); ok(!r.ok && /pengajuan lain/.test(r.error), 'nomor nota yang dipakai pengajuan lain yang masih berjalan ditolak');
  B8.VATopup.push(['V9', 'D001', 'P1', '2026-10-19', 100000000, 'tambah saldo uji', '', 'U2', '', '', '']);   // saldo uji sudah terpakai uji sebelumnya
  r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('adm'), pengajuan_id: itNN[1], keputusan: [{ item_id: itNN[0], status: 'DISETUJUI' }] });
  const txNN = B8.Transaksi.find(t => t[14] === itNN[0]);
  ok(r.ok && itNN[14] === 'TEREALISASI' && txNN && txNN[3] === 'NT-TELUR' && txNN[10] === 'https://drive.google.com/nota-x', 'disetujui → otomatis terealisasi dengan nomor nota & foto pengajuan: ' + (r.error || (txNN && txNN[3])));
  // kompatibilitas mundur realisasiItem untuk tunggakan lama DISETUJUI: tetap menolak tanggal di luar tanggal pengajuan
  B8.PengajuanItem.push(['IT-TGL', itNN[1], 'D001', 'P1', 9, 'Bahan Baku', 'Semua Kategori', 'Lama tgl', 50000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI', '', 1, '', '', '', '', '', '', 'https://drive.google.com/nota-x', '']);
  r = call(e8, 'POST', { action: 'realisasiItem', token: tkA, item_id: 'IT-TGL', tanggal: '2026-10-19' });
  ok(!r.ok && /sama dengan tanggal pengajuan \(15-10-2026\)/.test(r.error), 'realisasi di luar tanggal pengajuan ditolak: ' + (r.error || ''));
  r = pa([bb({ uraian: 'tanpa nomor', rincian: rincNN })]); ok(r.ok, 'nota tanpa nomor boleh (kosong)');
  const itTN = B8.PengajuanItem[B8.PengajuanItem.length - 1];
  r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('adm'), pengajuan_id: itTN[1], keputusan: [{ item_id: itTN[0], status: 'DISETUJUI' }] });
  const txTN = B8.Transaksi.find(t => t[14] === itTN[0]);
  ok(r.ok && txTN && /^S1-20261015-\d{3}$/.test(txTN[3]), 'nota tak bernomor → nomor otomatis saat disetujui: ' + (txTN && txTN[3]));
  // edit baris: nomor nota ikut diperiksa
  r = pa([bb({ uraian: 'edit', nota_no: 'NT-EDIT', rincian: rincNN })]);
  const itED = B8.PengajuanItem[B8.PengajuanItem.length - 1][0];
  r = call(e8, 'POST', { action: 'updatePengajuanItem', token: tkAst, item_id: itED, jenis: 'Bahan Baku', kategori: 'Semua Kategori', uraian: 'edit', nominal: 150000, penerima_id: 'pn1', rincian: rincNN, nota_no: 'NT-TELUR' });
  ok(!r.ok && /sudah dipakai/.test(r.error), 'edit ke nomor nota yang sudah dipakai ditolak');
  r = call(e8, 'POST', { action: 'updatePengajuanItem', token: tkAst, item_id: itED, jenis: 'Bahan Baku', kategori: 'Semua Kategori', uraian: 'edit', nominal: 150000, penerima_id: 'pn1', rincian: rincNN, nota_no: 'NT-EDIT' });
  ok(r.ok, 'edit dengan nomor notanya sendiri tetap boleh: ' + (r.error || ''));

  ok(e8.teksSel('01-2026') === "'01-2026" && e8.teksSel('1/10') === "'1/10" && e8.teksSel('NT-001') === 'NT-001' && e8.teksSel('') === '', 'nomor bukti mirip tanggal/angka disimpan sebagai teks');

  // ── Daftar relawan tetap: bisa diatur kapan saja, dipakai otomatis untuk pembayaran honor baru ──
  {
    let r = call(e8, 'POST', { action: 'saveRelawanTetap', token: tk8('pic'), rows: [{ nama: 'Siti', tugas: 'Juru masak', hari: 1, upah: 150000, metode: 'Transfer', hadir: true }, { nama: 'Joko', tugas: 'Distribusi', hari: 1, upah: 0 }] });
    ok(!r.ok && /upah per hari wajib/.test(r.error), 'daftar tetap: upah 0 ditolak');
    r = call(e8, 'POST', { action: 'saveRelawanTetap', token: tk8('yay'), rows: [{ nama: 'X', upah: 1000 }] });
    ok(!r.ok, 'Yayasan tidak bisa mengubah daftar relawan tetap');
    r = call(e8, 'POST', { action: 'saveRelawanTetap', token: tk8('pic'), rows: [{ nama: 'Siti', tugas: 'Juru masak', hari: 1, upah: 150000, metode: 'Transfer', hadir: true }, { nama: 'Joko', tugas: 'Distribusi', hari: 1, upah: 120000, hadir: false }] });
    ok(r.ok && r.data.jumlah === 2 && r.data.perHari === 150000, 'daftar tetap tersimpan (honor per hari yang aktif ' + (r.data && r.data.perHari) + '): ' + (r.error || ''));
    r = call(e8, 'GET', { action: 'getRelawanTetap', token: tk8('akn') });
    ok(r.ok && r.data.sumber === 'tetap' && r.data.rows.length === 2 && r.data.rows[1].hadir === false, 'akuntan membaca daftar tetap yang sama');
    B8.Transaksi.push(['TH9', 'D001', '2026-10-20', 'HN-9', 'Operasional', 'Gaji/honor relawan pekerja SPPG', 'Honor relawan 20 Okt', 'VA', 270000, 270000, 'https://x', '', 'U2', 'P1', '']);
    r = call(e8, 'POST', { action: 'getRelawanBayar', token: tk8('pic'), transaksi_id: 'TH9' });
    ok(r.ok && r.data.sumber === 'disalin dari daftar relawan tetap' && r.data.rows.length === 2 && r.data.rows[0].hadir === true && r.data.rows[1].hadir === false, 'pembayaran honor baru memakai daftar tetap (centang = biasanya hadir)');
  }

  // ── Data Penerima (relawan / PIC sekolah / kader) + tanda tangan tersimpan ──
  {
    const tP = tk8('pic'), tA = tk8('akn'), png = 'data:image/png;base64,' + Buffer.from('ttd').toString('base64');
    let r = call(e8, 'POST', { action: 'saveDataPenerima', token: tP, jenis: 'KADER', nama: 'Bu Ani', nominal: 50000 });
    ok(!r.ok && /posyandu wajib/.test(r.error), 'kader tanpa nama posyandu ditolak');
    r = call(e8, 'POST', { action: 'saveDataPenerima', token: tP, jenis: 'KADER', nama: 'Bu Ani', lembaga: 'Posyandu Melati', pm: 40, nominal: 50000 });
    ok(r.ok && r.data.id, 'kader tersimpan: ' + (r.error || ''));
    const idK = r.data.id;
    r = call(e8, 'POST', { action: 'saveDataPenerima', token: tA, jenis: 'KADER', nama: 'bu ani', lembaga: 'X', nominal: 1 });
    ok(!r.ok && /sudah ada/.test(r.error), 'nama ganda dalam jenis yang sama ditolak');
    r = call(e8, 'POST', { action: 'saveDataPenerima', token: tk8('yay'), jenis: 'RELAWAN', nama: 'Z', nominal: 1 });
    ok(!r.ok, 'Yayasan tidak bisa menambah data penerima');
    r = call(e8, 'POST', { action: 'saveTtd', token: tA, untuk: 'penerima', id: idK, fileData: png });
    ok(r.ok, 'akuntan menyimpan TTD penerima: ' + (r.error || ''));
    r = call(e8, 'POST', { action: 'getDataPenerima', token: tP });
    const k = r.data.rows.find(x => x.id === idK);
    ok(r.ok && k && k.ada_ttd === true && k.pm === 40 && k.lembaga === 'Posyandu Melati' && r.data.bisaUbah, 'daftar penerima menandai TTD tersimpan');
    r = call(e8, 'POST', { action: 'saveTtd', token: tA, untuk: 'kepala', fileData: png });
    ok(!r.ok && /PIC/.test(r.error), 'TTD Kepala SPPG hanya lewat PIC');
    r = call(e8, 'POST', { action: 'saveTtd', token: tP, untuk: 'kepala', fileData: png });
    ok(r.ok && e8.__props['ttd_KEPALA_D001'], 'PIC menyimpan TTD Kepala SPPG dapurnya: ' + (r.error || ''));
    r = call(e8, 'POST', { action: 'getTtd', token: tP, untuk: 'kepala' });
    ok(r.ok && /^data:image\/png;base64,/.test(r.data.ttd), 'TTD Kepala SPPG terbaca kembali');
    r = call(e8, 'POST', { action: 'saveTtd', token: tP, fileData: png });
    ok(r.ok, 'PIC kini bisa menyimpan TTD dirinya sendiri: ' + (r.error || ''));
    const fidK = e8.__props['ttd_P_' + idK];
    r = call(e8, 'POST', { action: 'hapusDataPenerima', token: tP, id: idK });
    ok(r.ok && !e8.__props['ttd_P_' + idK] && e8.__files[fidK].trashed, 'hapus penerima ikut membuang TTD-nya');
    // relawan tetap = Data Penerima jenis RELAWAN (satu sumber)
    r = call(e8, 'POST', { action: 'getDataPenerima', token: tA });
    const rel = r.data.rows.filter(x => x.jenis === 'RELAWAN');
    ok(rel.length === 2 && rel.some(x => x.nama === 'Siti' && x.nominal === 150000 && x.jabatan === 'Juru masak') && rel.some(x => x.nama === 'Joko' && !x.aktif), 'daftar relawan tetap tersimpan sebagai Data Penerima RELAWAN');
    const idSiti = rel.find(x => x.nama === 'Siti').id;
    call(e8, 'POST', { action: 'saveTtd', token: tA, untuk: 'penerima', id: idSiti, fileData: png });
    r = call(e8, 'POST', { action: 'saveRelawanTetap', token: tP, rows: [{ nama: 'Siti', tugas: 'Juru masak', hari: 1, upah: 160000, metode: 'Transfer', hadir: true }] });
    r = call(e8, 'POST', { action: 'getDataPenerima', token: tA });
    const rel2 = r.data.rows.filter(x => x.jenis === 'RELAWAN');
    ok(rel2.length === 1 && rel2[0].id === idSiti && rel2[0].nominal === 160000 && rel2[0].ada_ttd, 'ubah daftar relawan lewat pengaturan gaji: id & TTD tetap, yang dihapus hilang');
  }

  // ── Relawan yang sudah tercatat sebelum ada Data Penerima ikut masuk (impor sekali per dapur) ──
  {
    const tAd = tk8('adm');
    B8.RelawanBayar = B8.RelawanBayar || [['transaksi_id', 'dapur_id', 'data_json', 'updated_at', 'updated_by']];
    B8.RelawanBayar.push(['TX-A', 'D002', JSON.stringify([{ nama: 'Ani', tugas: 'Masak', hari: 1, upah: 100000, hadir: true }, { nama: 'Budi', tugas: 'Cuci', hari: 1, upah: 90000, hadir: true }]), '', 'U2']);
    B8.RelawanBayar.push(['TX-B', 'D002', JSON.stringify([{ nama: 'ani ', tugas: '', hari: 1, upah: 110000, hadir: true }, { nama: 'Budi', tugas: 'Cuci', hari: 1, upah: 90000, hadir: false }, { nama: 'Cici', tugas: 'Antar', hari: 1, upah: 80000, hadir: true, metode: 'Tunai' }]), '', 'U2']);
    let r = call(e8, 'POST', { action: 'getDataPenerima', token: tAd, dapur: 'D002' });
    const rel = r.data.rows.filter(x => x.jenis === 'RELAWAN');
    const by = Object.fromEntries(rel.map(x => [x.nama.trim(), x]));
    ok(r.ok && r.data.diimpor === 3 && rel.length === 3, 'relawan dari pembayaran honor lama diimpor (' + (r.data && r.data.diimpor) + ')');
    ok(by.Ani && by.Ani.nominal === 110000 && by.Ani.jabatan === 'Masak' && by.Ani.aktif && !by.Budi.aktif && by.Cici.aktif && by.Cici.metode === 'Tunai', 'upah terbaru dipakai, tugas lama dipertahankan; tidak hadir di pembayaran terakhir = nonaktif');
    r = call(e8, 'POST', { action: 'getDataPenerima', token: tAd, dapur: 'D002' });
    ok(r.data.diimpor === 0 && r.data.rows.filter(x => x.jenis === 'RELAWAN').length === 3, 'impor hanya sekali (tidak dobel)');
    r = call(e8, 'POST', { action: 'hapusDataPenerima', token: tAd, id: by.Cici.id });
    r = call(e8, 'POST', { action: 'getDataPenerima', token: tAd, dapur: 'D002' });
    ok(r.data.rows.filter(x => x.jenis === 'RELAWAN').length === 2, 'yang sengaja dihapus tidak muncul lagi');
    ok(e8.htmlKuitansi({ ttdPenyerah: 'data:image/png;base64,QUJD', ttdPenerima: 'javascript:x' }).indexOf('<img src="data:image/png;base64,QUJD"') > 0
      && e8.htmlKuitansi({ ttdPenerima: '" onerror="x' }).indexOf('onerror') < 0, 'kuitansi menempel TTD gambar (hanya data:image yang sah)');
  }

  // ── Kwitansi harian: 1 orang 1 kwitansi, BASTI bernomor urut per bulan, nomor tetap saat cetak ulang ──
  {
    const tP = tk8('pic'), tA = tk8('akn');
    const kd = call(e8, 'POST', { action: 'saveDataPenerima', token: tP, jenis: 'KADER', nama: 'Bu Rina', lembaga: 'Posyandu Mawar', pm: 35, nominal: 50000 }).data.id;
    const ps = call(e8, 'POST', { action: 'saveDataPenerima', token: tP, jenis: 'PIC_SEKOLAH', nama: 'Pak Dedi', lembaga: 'SDN 1', pm: 300, nominal: 100000 }).data.id;
    let r = call(e8, 'POST', { action: 'getKwitansiHarian', token: tA, tanggal: '2026-10-21' });
    ok(r.ok && r.data.rows.length === 3 && r.data.rows.every(x => x.pilih) && r.data.sudahTerbit === 0, 'daftar kwitansi: semua penerima aktif terpilih (' + (r.data && r.data.rows.length) + ')');
    const siti = r.data.rows.find(x => x.jenis === 'RELAWAN');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-10-21', rows: [{ penerima_id: kd, nominal: 50000, pm: 40 }, { penerima_id: ps, nominal: 100000, pm: 300 }, { penerima_id: siti.penerima_id, nominal: 160000 }] });
    ok(r.ok && r.data.rows.length === 3, 'kwitansi terbit: ' + (r.error || ''));
    const nr = Object.fromEntries(r.data.rows.map(x => [x.penerima_id, x.nomor]));
    ok(r.data.rows[0].jenis === 'RELAWAN' && nr[siti.penerima_id] === '001/TTUR/SPPG-S1/X/2026' && nr[ps] === '01/BASTI/SPPG-S1/X/2026' && nr[kd] === '02/BASTI/SPPG-S1/X/2026', 'relawan bernomor TTUR sendiri; BASTI urut (PIC sekolah lalu kader): ' + JSON.stringify(nr));
    ok(r.data.rows.find(x => x.penerima_id === kd).pm === 40 && /^data:image/.test(r.data.rows.find(x => x.penerima_id === siti.penerima_id).ttd) && r.data.kepala && r.data.akuntan, 'PM disesuaikan; TTD penerima ikut; data akuntan & kepala tersedia');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-10-21', rows: [{ penerima_id: kd, nominal: 55000, pm: 40 }] });
    ok(r.ok && r.data.rows[0].nomor === '02/BASTI/SPPG-S1/X/2026' && r.data.rows[0].nominal === 55000, 'cetak ulang: nomor tetap, nominal ikut berubah');
    r = call(e8, 'POST', { action: 'getKwitansiHarian', token: tP, tanggal: '2026-10-21' });
    ok(r.data.sudahTerbit === 1 && r.data.rows.filter(x => x.pilih).length === 1 && r.data.rows.find(x => x.penerima_id === kd).nominal === 55000, 'yang tidak dipilih lagi dibuang dari tanggal itu');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-10-22', rows: [{ penerima_id: ps, nominal: 100000, pm: 300 }] });
    ok(r.data.rows[0].nomor === '03/BASTI/SPPG-S1/X/2026', 'nomor yang sempat dibuang tidak dipakai ulang (' + r.data.rows[0].nomor + ')');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-11-02', rows: [{ penerima_id: kd, nominal: 50000, pm: 35 }] });
    ok(r.data.rows[0].nomor === '01/BASTI/SPPG-S1/XI/2026', 'bulan baru mulai dari 01 (' + r.data.rows[0].nomor + ')');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-11-02', rows: [{ penerima_id: kd, nominal: 1 }, { penerima_id: kd, nominal: 1 }] });
    ok(!r.ok && /dua kali/.test(r.error), '1 orang hanya 1 kwitansi per hari');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tk8('yay'), tanggal: '2026-11-02', rows: [{ penerima_id: kd, nominal: 1 }] });
    ok(!r.ok, 'Yayasan tidak bisa menerbitkan kwitansi');
  }

  // ── Catatan akuntan (mis. melebihi pagu harian) ikut ke Yayasan & tidak hilang saat diputuskan ──
  {
    let r = call(e8, 'POST', { action: 'createPengajuan', token: tk8('akn'), tanggal: '2026-10-16', request_id: 'cat-1',
      items: [{ jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas 12 kg', nominal: 900000, rencana_riil: 850000, nota_url: 'https://drive.google.com/gas-cat', penerima_id: 'pn1', catatan: 'Melebihi pagu harian Rp 200.000. Alasan: stok gas habis' }] });
    ok(r.ok, 'pengajuan dengan catatan akuntan terkirim: ' + (r.error || ''));
    const it = B8.PengajuanItem.find(x => x[1] === r.data.id);
    ok(it && it[15] === 'Catatan akuntan: Melebihi pagu harian Rp 200.000. Alasan: stok gas habis', 'catatan tersimpan dengan awalan "Catatan akuntan:" (' + (it && it[15]) + ')');
    r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('adm'), pengajuan_id: it[1], keputusan: [{ item_id: it[0], status: 'DISETUJUI' }] });
    ok(!r.ok && /melebihi pagu: wajib isi catatan persetujuan/.test(r.error), 'melebihi pagu: wajib isi catatan persetujuan saat menyetujui');
    r = call(e8, 'POST', { action: 'decidePengajuan', token: tk8('adm'), pengajuan_id: it[1], keputusan: [{ item_id: it[0], status: 'DISETUJUI', catatan: 'Disetujui karena stok habis' }] });
    ok(r.ok && it[14] === 'TEREALISASI' && /Catatan persetujuan: Disetujui karena stok habis \| Catatan akuntan: Melebihi pagu/.test(it[15]), 'disetujui dengan catatan → otomatis terealisasi & catatan persetujuan + catatan akuntan tetap ada: ' + (r.error || it[15]));
  }

  // ── Rencana operasional per periode ──
  {
    const tAkn = tk8('akn');
    let r = call(e8, 'GET', { action: 'getRencanaOps', token: tAkn });
    ok(r.ok && r.data.periode.id === 'P1' && r.data.rencana === null && r.data.penerima.some(p => p.id === 'pn1'), 'rencana: periode aktif dimuat, belum ada rencana: ' + (r.error || ''));
    { const L = r.data.luar || [];
      ok(L.some(x => x.pitem_id === 'K-GAS' && x.status === 'TEREALISASI' && x.nominal === 200000), 'pengajuan operasional dari menu Pengajuan masuk daftar "di luar rencana" (' + L.length + ')');
      ok(L.some(x => x.id === 'LUAR-T1' && x.status === 'TRANSAKSI' && x.kategori === 'Listrik'), 'transaksi operasional tanpa pengajuan ikut dihitung');
      ok(!L.some(x => x.kategori === 'Semua Kategori' || /DITOLAK|DIBATALKAN/.test(x.status)), 'bahan baku & pengajuan batal/ditolak tidak ikut'); }
    const isi = { versi: 0, setelan: { indeks: 100, batas: 95 }, hari: { '2026-10-09': { pm: 200 }, '2026-10-12': { libur: true }, '2026-12-01': { pm: 5 } },
      items: [{ id: 'RO1', tanggal: '2026-10-09', kategori: 'Gas', uraian: 'Isi gas 12 kg', nominal: 300000, penerima_id: 'pn1' }, { id: 'RO2', tanggal: '', kategori: 'APD', uraian: 'Masker', nominal: 50000 }] };
    r = call(e8, 'POST', { action: 'saveRencanaOps', token: tAkn, data: isi });
    ok(r.ok && r.data.versi === 1, 'rencana tersimpan (versi 1): ' + (r.error || ''));
    r = call(e8, 'GET', { action: 'getRencanaOps', token: tAkn });
    ok(r.data.rencana.items.length === 2 && r.data.rencana.hari['2026-10-09'].pm === 200 && !r.data.rencana.hari['2026-12-01'], 'isi rencana terbaca kembali; tanggal di luar periode dibuang');
    r = call(e8, 'POST', { action: 'saveRencanaOps', token: tAkn, data: isi });
    ok(!r.ok && /perangkat lain/.test(r.error), 'simpan dengan versi lama ditolak (tidak menimpa perubahan perangkat lain)');
    r = call(e8, 'POST', { action: 'saveRencanaOps', token: tAkn, data: Object.assign({}, isi, { versi: 1, items: [{ kategori: 'Beras', uraian: 'x', nominal: 1 }] }) });
    ok(!r.ok && /kategori operasional/.test(r.error), 'kategori bukan operasional ditolak');
    r = call(e8, 'POST', { action: 'saveRencanaOps', token: tk8('pic'), data: Object.assign({}, isi, { versi: 1 }) });
    ok(!r.ok && /Hanya akuntan/.test(r.error), 'PIC tidak bisa mengubah rencana');
    r = call(e8, 'GET', { action: 'getPaguOps', token: tAkn, tanggal: '2026-10-09' });
    ok(r.ok && r.data.pagu === 600000 && r.data.pm === 200, 'pagu harian = 3.000 × PM hari itu (PM disesuaikan 200): ' + JSON.stringify(r.data));
    ok(r.data.terpakai === 100000, 'operasional terpakai hari itu memakai nilai anggaran (' + r.data.terpakai + ')');
    ok(r.data.diajukan === 0 && r.data.rencanaBelum === 300000, 'pagu hari: rencana yang belum diajukan ikut dilaporkan (' + r.data.rencanaBelum + ')');
    r = call(e8, 'GET', { action: 'getPaguOps', token: tAkn, tanggal: '2026-10-10' });
    ok(r.data.libur === true && r.data.pagu === 0, 'Sabtu bukan HPE → pagu 0');
    r = call(e8, 'GET', { action: 'getPaguOps', token: tAkn, tanggal: '2026-10-13' });
    ok(r.data.pagu === 300000 && r.data.libur === false, 'tanpa penyesuaian: PM = penerima di setup periode (100)');
    r = call(e8, 'GET', { action: 'getPaguOps', token: tAkn, tanggal: '2026-10-12' });
    ok(r.data.libur === true && r.data.pagu === 0, 'hari yang ditandai libur di rencana → pagu 0');
  }

  // ── Sinkron: biaya admin bahan baku di pagu, kwitansi harian tertaut ke LPDH ──
  {
    const tA = tk8('akn'), tP = tk8('pic'), png = 'data:image/png;base64,' + Buffer.from('ttd').toString('base64');
    let r = call(e8, 'GET', { action: 'getRencanaOps', token: tA });
    ok(r.ok && r.data.adminBB['2026-10-10'] === 6500 && !r.data.adminBB['2026-10-11'] && r.data.bbDefault === 0, 'rencana ops: biaya admin milik bahan baku dihitung per tanggal (' + JSON.stringify(r.data && r.data.adminBB) + ')');
    r = call(e8, 'POST', { action: 'saveRencanaOps', token: tA, data: { versi: r.data.rencana ? r.data.rencana.versi : 0, setelan: { indeks: 100, batas: 95, bb: 12 }, hari: {}, items: [] } });
    ok(r.ok, 'setelan transfer bahan baku per hari tersimpan: ' + (r.error || ''));
    r = call(e8, 'GET', { action: 'getRencanaOps', token: tA });
    ok(r.data.rencana.setelan.bb === 12, 'setelan bb terbaca kembali');
    r = call(e8, 'GET', { action: 'getPaguOps', token: tA, tanggal: '2026-10-13' });
    ok(r.ok && r.data.cadanganBB === 12 * 6500, 'form Pengajuan: cadangan admin bahan baku ikut dihitung (' + (r.data && r.data.cadanganBB) + ')');
    B8.Transaksi.push(['TFEE', 'D001', '2026-10-13', 'NB-ADM2', 'Operasional', 'Biaya Admin Bank', 'Admin', 'VA', 6500, 6500, 'https://x', '', 'U2', 'P1', 'ADMIN:IT1']);
    r = call(e8, 'GET', { action: 'getPaguOps', token: tA, tanggal: '2026-10-13' });
    ok(r.data.cadanganBB === 12 * 6500 - 6500, 'cadangan dikurangi admin bahan baku yang sudah nyata (' + (r.data && r.data.cadanganBB) + ')');

    // kwitansi harian → PDF tersimpan & tertaut ke data LPDH
    r = call(e8, 'POST', { action: 'simpanKwitansiFile', token: tk8('yay'), tanggal: '2026-10-10', jenis: 'KADER', fileData: 'JVBERg==' });
    ok(!r.ok, 'Yayasan tidak bisa menyimpan file kwitansi');
    r = call(e8, 'POST', { action: 'simpanKwitansiFile', token: tP, tanggal: '2026-10-10', jenis: 'KADER', fileData: 'data:application/pdf;base64,JVBERg==' });
    ok(r.ok && /^https:/.test(r.data.url), 'file kwitansi kader tersimpan: ' + (r.error || ''));
    const url1 = r.data.url;
    r = call(e8, 'POST', { action: 'simpanKwitansiFile', token: tP, tanggal: '2026-10-10', jenis: 'KADER', fileData: 'JVBERg==' });
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-10' });
    ok(r.ok && r.data.kwitansi.KADER && /^https:/.test(r.data.kwitansi.KADER) && Object.keys(r.data.kwitansi).length === 1, 'LPDH menerima tautan kwitansi harian (satu per jenis, ditimpa saat terbit ulang)');
    ok(r.data.transaksi.every(x => x.insentif === null || typeof x.insentif.ttd_otomatis === 'boolean'), 'insentif Mitra membawa penanda TTD otomatis');
    // sinkron nilai kwitansi vs transaksi tercatat
    B8.Transaksi.push(['TK1', 'D001', '2026-10-10', 'KD-1', 'Operasional', 'Insentif Kader Posyandu', 'Insentif kader', 'VA', 150000, 150000, 'https://x', '', 'U2', 'P1', '']);
    r = call(e8, 'POST', { action: 'getKwitansiHarian', token: tA, tanggal: '2026-10-10' });
    ok(r.ok && r.data.tercatat.KADER === 150000 && r.data.tercatat.RELAWAN === 0 && r.data.file.KADER, 'kwitansi harian menampilkan nilai tercatat per jenis & tautan PDF');
  }


  // ── LPDH selalu menaut kwitansi bertanda tangan: yang belum ada / usang dibuat ulang ──
  {
    const tA = tk8('akn'), tP = tk8('pic'), png = 'data:image/png;base64,' + Buffer.from('ttd2').toString('base64');
    let r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-21' });
    ok(r.ok && !('kwitansiPerlu' in r.data) && JSON.stringify(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-21' }).data.perlu) === '["KADER"]', 'kwitansi terbit tanpa PDF → diminta dibuat saat unduh (dicek terpisah, tidak memberatkan pemuatan LPDH)');
    r = call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21' });
    ok(r.ok && r.data.rows.length === 1 && r.data.rows[0].nomor === '02/BASTI/SPPG-S1/X/2026' && r.data.rows[0].nominal === 55000 && r.data.kepala && r.data.akuntan && r.data.pic,
      'bahan cetak ulang memakai kwitansi yang sudah terbit (nomor & nominal tetap)');
    const idKd = r.data.rows[0].penerima_id;
    call(e8, 'POST', { action: 'simpanKwitansiFile', token: tP, tanggal: '2026-10-21', jenis: 'KADER', fileData: 'JVBERg==' });
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-21' });
    ok(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-21' }).data.perlu.length === 0 && /^https:/.test(r.data.kwitansi.KADER), 'setelah PDF tersimpan: tidak perlu dibuat lagi, link masuk LPDH');
    ok(JSON.stringify(r.data.kwitansiNomor) === JSON.stringify({ PIC_SEKOLAH: [], KADER: ['02/BASTI/SPPG-S1/X/2026'], RELAWAN: {} }), 'LPDH membawa nomor BASTI kwitansi hari itu (' + JSON.stringify(r.data.kwitansiNomor) + ')');
    call(e8, 'POST', { action: 'saveTtd', token: tA, untuk: 'penerima', id: idKd, fileData: png });
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-21' });
    ok(JSON.stringify(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-21' }).data.perlu) === '["KADER"]', 'tanda tangan penerima berubah → PDF lama dianggap usang & dibuat ulang');
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tk8('yay'), dapur: 'D001', tanggal: '2026-10-21' });
    ok(r.ok && call(e8, 'POST', { action: 'getKwitansiPerlu', token: tk8('yay'), dapur: 'D001', tanggal: '2026-10-21' }).data.perlu.length === 0, 'Yayasan (hanya baca) tidak diminta membuat kwitansi');
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-17' });
    ok(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-17' }).data.perlu.indexOf('INSENTIF') >= 0, 'insentif Mitra/Yayasan hari itu → kuitansi bertanda tangan diminta dibuat');
    r = call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-17' });
    ok(r.data.insentif.length === 1 && r.data.insentif[0].nominal === 5000000 && r.data.insentif[0].no_bukti === 'INS-1' && 'ttd' in r.data.pengawas, 'bahan kuitansi insentif: nominal, nomor bukti, penandatangan');
    r = call(e8, 'POST', { action: 'simpanKwitansiFile', token: tP, tanggal: '2026-10-17', jenis: 'INSENTIF', fileData: 'JVBERg==' });
    ok(r.ok, 'PDF kuitansi insentif tersimpan: ' + (r.error || ''));
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-17' });
    ok(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-17' }).data.perlu.indexOf('INSENTIF') < 0 && /^https:/.test(r.data.kwitansi.INSENTIF), 'link kuitansi insentif bertanda tangan masuk LPDH');
  }


  // ── Porsi PM per sekolah & Tugas Harian PIC ──
  {
    const tP = tk8('pic');
    const pm = [{ kode: 'KS-02', target: 228, distribusi: 228, diterima: 225, tidak: 3, alasan: 'PM tidak hadir' }];
    let r = call(e8, 'POST', { action: 'saveHarianLPDH', token: tP, tanggal: '2026-10-23', data: { sekolah: [{ nama: 'SDN CAGAK', jenjang: '', besar: 235, kecil: 228 }], pm: pm } });
    ok(!r.ok && /jenjang/.test(r.error), 'sekolah tanpa jenjang ditolak');
    r = call(e8, 'POST', { action: 'saveHarianLPDH', token: tP, tanggal: '2026-10-23', data: { sekolah: [{ nama: 'SDN CAGAK', jenjang: 'SD', besar: 235, kecil: 228 }], pm: pm, produksi: { total: 473, organoleptik: 10 },
      syarat: { kontaminasi: 'Tidak', fatal: 'Tidak', suspend: 'Tidak', verifikasi: 'Ya', sipgn: 'Ya' } } });
    ok(r.ok, 'porsi per sekolah tersimpan: ' + (r.error || ''));
    r = call(e8, 'POST', { action: 'getHarianLPDH', token: tP, tanggal: '2026-10-26' });
    ok(r.data.data.sekolah.length === 1 && r.data.data.sekolah[0].jenjang === 'SD' && /disalin/.test(r.data.sumber), 'daftar sekolah disalin ke hari berikutnya');
    r = call(e8, 'POST', { action: 'getTugasHarian', token: tP, tanggal: '2026-10-23' });
    ok(r.ok && r.data.porsi.ada && r.data.porsi.sekolah === 1 && r.data.porsi.total === 228 && r.data.porsi.syarat === true && r.data.bisaSetuju === true,
      'tugas harian: porsi PM per sekolah & syarat insentif terbaca (' + JSON.stringify(r.data && r.data.porsi) + ')');
    ok(typeof r.data.persetujuan.baris === 'number' && r.data.penerima.aktif.RELAWAN >= 1 && 'kepala' in r.data.ttd && Array.isArray(r.data.lpdh.kwitansiPerlu), 'tugas harian: persetujuan, penerima aktif, TTD, LPDH');
    r = call(e8, 'POST', { action: 'getTugasHarian', token: tk8('akn'), tanggal: '2026-10-24' });
    ok(r.ok && r.data.porsi.ada === false && r.data.bisaSetuju === false, 'hari tanpa isian: porsi belum diisi; akuntan tidak menyetujui');
  }


  // ── Beban per permintaan: pemuatan LPDH & Tugas Harian tidak membaca sheet/Properties berulang ──
  {
    const tA = tk8('akn'), tP = tk8('pic');
    const ukur = (fn) => { e8.__baca = {}; e8.__nProps = 0; e8.__nDrive = 0; const r = fn(); const tot = Object.values(e8.__baca).reduce((a, b) => a + b, 0); return { r, baca: Object.assign({}, e8.__baca), tot, props: e8.__nProps, drive: e8.__nDrive }; };
    let m = ukur(() => call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-21' }));
    console.log('   getDataLPDH: ' + m.tot + ' baca sheet ' + JSON.stringify(m.baca) + ', ' + m.props + ' panggilan Properties');
    ok(m.r.ok && (m.baca.Transaksi || 0) <= 1 && (m.baca.KwitansiHarian || 0) <= 1 && (m.baca.Users || 0) <= 2 && m.props <= 3, 'pemuatan LPDH: Transaksi, KwitansiHarian & Users dibaca sekali, Properties ≤ 3×');
    m = ukur(() => call(e8, 'POST', { action: 'getTugasHarian', token: tP, tanggal: '2026-10-21' }));
    console.log('   getTugasHarian: ' + m.tot + ' baca sheet ' + JSON.stringify(m.baca) + ', ' + m.props + ' panggilan Properties');
    ok(m.r.ok && (m.baca.Transaksi || 0) <= 1 && (m.baca.KwitansiHarian || 0) <= 1 && m.props <= 3, 'Tugas Harian: tiap sheet dibaca sekali, Properties ≤ 3×');
    m = ukur(() => call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-21' }));
    ok(m.r.ok && m.props <= 2 && (m.baca.KwitansiHarian || 0) <= 1, 'cek kwitansi yang perlu dibuat: ringan (' + m.tot + ' baca, ' + m.props + ' Properties)');
    call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21' });
    m = ukur(() => call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21' }));
    ok(m.drive === 0, 'gambar tanda tangan diambil dari cache pada permintaan berikutnya (Drive dibuka ' + m.drive + '×)');
    m = ukur(() => call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21', jenis: 'INSENTIF' }));
    ok(m.r.ok && m.r.data.rows.length === 0, 'cetak ulang hanya jenis yang diminta (baris lain tidak dibaca)');
    // Jenis non-INSENTIF tidak perlu membaca sheet Transaksi (ribuan baris) saat cetak atau simpan PDF
    m = ukur(() => call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21', jenis: 'KADER' }));
    ok(m.r.ok && (m.baca.Transaksi || 0) === 0, 'getKwitansiCetak KADER tidak membaca sheet Transaksi (' + (m.baca.Transaksi || 0) + '×)');
    m = ukur(() => call(e8, 'POST', { action: 'simpanKwitansiFile', token: tP, tanggal: '2026-10-21', jenis: 'KADER', fileData: 'JVBERg==' }));
    ok(m.r.ok && (m.baca.Transaksi || 0) === 0, 'simpanKwitansiFile KADER tidak membaca sheet Transaksi (' + (m.baca.Transaksi || 0) + '×)');
    // TTD besar (> 100 KB base64, melebihi batas 1 kunci CacheService) tetap ter-cache terpotong → 0 buka Drive saat cetak
    const bigB64 = Buffer.alloc(110000, 65).toString('base64');   // ~146 KB base64 (< 300 KB batas TTD)
    const rBig = call(e8, 'POST', { action: 'saveTtd', token: tA, fileData: 'data:image/png;base64,' + bigB64 });
    ok(rBig.ok, 'simpan TTD besar (> 100 KB base64) berhasil');
    m = ukur(() => call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-21', jenis: 'KADER' }));
    ok(m.r.ok && m.drive === 0 && m.r.data.akuntan.ttd === 'data:image/png;base64,' + bigB64, 'TTD besar ter-cache terpotong (Drive dibuka ' + m.drive + '×)');

    // Cache sheet lintas-permintaan di CacheService: request ke-2 membaca 0 sheet (tanpa SpreadsheetApp.openById) & otomatis di-invalidasi saat ada penulisan
    e8.__srvCache = true;
    const mDash1 = ukur(() => call(e8, 'POST', { action: 'getDashboard', token: tA, scope: 'D001' }));
    const mDash2 = ukur(() => call(e8, 'POST', { action: 'getDashboard', token: tA, scope: 'D001' }));
    ok(mDash1.r.ok && Array.isArray(mDash1.r.data.periodeList) && mDash2.r.ok && mDash2.tot === 0, 'getDashboard menyertakan periodeList & request ke-2 membaca 0 sheet dari SpreadsheetApp (' + mDash2.tot + '×)');
    const mPj1 = ukur(() => call(e8, 'POST', { action: 'getPengajuan', token: tA, scope: 'D001' }));
    const mPj2 = ukur(() => call(e8, 'POST', { action: 'getPengajuan', token: tA, scope: 'D001' }));
    ok(mPj1.r.ok && Array.isArray(mPj1.r.data.baAktif) && mPj2.r.ok && mPj2.tot === 0, 'getPengajuan menyertakan baAktif & request ke-2 membaca 0 sheet dari SpreadsheetApp (' + mPj2.tot + '×)');
    e8.__srvCache = false;
  }


  // ── Nomor kwitansi relawan (TTUR): unik per orang, kwitansi lama tanpa nomor dilengkapi ──
  {
    const tA = tk8('akn'), tP = tk8('pic');
    let r = call(e8, 'POST', { action: 'getKwitansiHarian', token: tA, tanggal: '2026-10-27' });
    const rel = r.data.rows.filter(x => x.jenis === 'RELAWAN');
    r = call(e8, 'POST', { action: 'terbitkanKwitansi', token: tA, tanggal: '2026-10-27', rows: rel.map(x => ({ penerima_id: x.penerima_id, nominal: x.nominal })) });
    ok(r.ok && r.data.rows.every(x => /^\d{3}\/TTUR\/SPPG-S1\/X\/2026$/.test(x.nomor)) && new Set(r.data.rows.map(x => x.nomor)).size === r.data.rows.length,
      'tiap relawan dapat nomor TTUR unik (' + r.data.rows.map(x => x.nomor).join(', ') + ')');
    const sebelum = r.data.rows.map(x => x.nomor).join();
    // tiru kwitansi relawan lama (terbit sebelum ada nomor): kosongkan nomornya di sheet
    B8.KwitansiHarian.forEach((row, i) => { if (i && row[2] === '2026-10-27' && row[4] === 'RELAWAN') { row[5] = ''; row[6] = 0; } });
    ok(JSON.stringify(call(e8, 'POST', { action: 'getKwitansiPerlu', token: tA, tanggal: '2026-10-27' }).data.perlu).indexOf('RELAWAN') >= 0, 'kwitansi relawan tanpa nomor → perlu dibuat ulang');
    r = call(e8, 'POST', { action: 'getKwitansiCetak', token: tA, tanggal: '2026-10-27' });
    const sesudah = r.data.rows.filter(x => x.jenis === 'RELAWAN').map(x => x.nomor);
    ok(sesudah.length && sesudah.every(n => /\/TTUR\//.test(n)) && sesudah.join() !== sebelum, 'kwitansi relawan lama diberi nomor baru saat dicetak; nomor lama tidak dipakai ulang (' + sesudah.join(', ') + ')');
    r = call(e8, 'POST', { action: 'getDataLPDH', token: tA, dapur: 'D001', tanggal: '2026-10-27' });
    ok(Object.values(r.data.kwitansiNomor.RELAWAN).length === sesudah.length, 'LPDH membawa nomor kwitansi relawan per nama');
  }


  // ── Lembar pengesahan LPDH: TTD Perwakilan Mitra/Yayasan per dapur & bahan TTD tiga pihak ──
  {
    const png = 'data:image/png;base64,' + Buffer.from('ttd-wakil').toString('base64');
    let r = call(e8, 'POST', { action: 'saveTtd', token: tk8('akn'), untuk: 'wakil', fileData: png });
    ok(!r.ok, 'akuntan tidak menyimpan TTD Perwakilan Yayasan');
    r = call(e8, 'POST', { action: 'saveTtd', token: tk8('yay'), untuk: 'wakil', fileData: png });
    ok(!r.ok && /dapur/i.test(r.error), 'Yayasan wajib memilih dapur');
    r = call(e8, 'POST', { action: 'saveTtd', token: tk8('yay'), untuk: 'wakil', dapur: 'D001', fileData: png });
    ok(r.ok && e8.__props['ttd_WAKIL_D001'], 'Yayasan menyimpan TTD Perwakilan untuk dapur D001: ' + (r.error || ''));
    r = call(e8, 'POST', { action: 'getTtdPengesahan', token: tk8('pic') });
    ok(r.ok && /^data:image/.test(r.data.wakil) && /^data:image/.test(r.data.kepala) && 'pengawas' in r.data, 'bahan TTD pengesahan: pengawas, kepala, perwakilan');
    r = call(e8, 'POST', { action: 'getTtdPengesahan', token: tk8('yay'), dapur: 'D002' });
    ok(r.ok && r.data.wakil === null, 'dapur lain tidak memakai TTD perwakilan D001');
  }


  // ── Realisasi massal (admin): simulasi → eksekusi, tanggal & nominal mengikuti pengajuan ──
  {
    const tAd = tk8('adm'), tA = tk8('akn');
    B8.Dapur.push(['D009', 'SPPG Sembilan', '', 'S9']);
    B8.Setup.push(['P0', 'D009', 1, '2026-09-01', '2026-09-30', 100, 50000000, 0, 'DITUTUP'], ['P9', 'D009', 2, '2026-10-01', '2026-10-31', 100, 20000000, 0, 'AKTIF']);
    const hd = (id, tgl, per) => B8.Pengajuan.push([id, 'BA-' + id, 'D009', per, tgl, 'SELESAI', '', 'U2', '', 'U3']);
    hd('PZ1', '2026-09-10', 'P0'); hd('PZ2', '2026-10-05', 'P9'); hd('PZ3', '2026-09-40', 'P0');
    const it = (id, pa, urut, per, jenis, kat, nom, extra) => B8.PengajuanItem.push([id, pa, 'D009', per, urut, jenis, kat, 'Uraian ' + id, nom, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI', '', 1, '', 'U3', '', '', '', '', (extra || {}).nota_url || '', (extra || {}).nota_no || '']);
    it('PZ1-1', 'PZ1', 1, 'P0', 'Bahan Baku', 'Semua Kategori', 1500000, { nota_no: 'NOTA-7', nota_url: 'https://nota/7' });
    it('PZ1-2', 'PZ1', 2, 'P0', 'Operasional', 'Gas', 300000);
    it('PZ2-1', 'PZ2', 1, 'P9', 'Operasional', 'Listrik', 700000);
    it('PZ2-2', 'PZ2', 2, 'P9', 'Bahan Baku', 'Semua Kategori', 400000, { nota_no: 'NOTA-7' });   // nomor nota kembar → nomor otomatis
    it('PZ3-1', 'PZ3', 1, 'P0', 'Operasional', 'Gas', 100000);                                       // tanggal pengajuan tidak valid
    const M1 = { saldoAwal: 0, saldoAkhir: 0, debit: [{ tgl: '2026-09-10', nom: 1500000, rek: '000123', fee: 0, ref: 'J1', ket: 'Toko A' }, { tgl: '2026-09-11', nom: 300000, rek: '123', fee: 6500, ref: 'J2', ket: 'gas' },
      { tgl: '2026-10-05', nom: 700000, rek: '123', fee: 0, ref: 'J3', ket: 'listrik' }, { tgl: '2026-10-05', nom: 400000, rek: '123', fee: 6500, ref: 'J4', ket: 'bahan' }, { tgl: '2026-10-05', nom: 999000, rek: '555', fee: 0, ref: 'J5', ket: 'gaji tanpa pengajuan' }] };
    let r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009' });
    ok(!r.ok && /mutasi/i.test(r.error), 'tanpa mutasi rekening: realisasi massal ditolak');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tA, dapur: 'D009', mutasi: M1 });
    ok(!r.ok && /admin/i.test(r.error), 'hanya admin yang boleh realisasi massal');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', mutasi: M1 });
    ok(r.ok && r.data.simulasi && r.data.jumlah === 2 && r.data.nominal === 1100000, 'simulasi: hanya periode aktif (2 baris, Rp 1.100.000) — periode ditutup & tanggal rusak dilewati (' + JSON.stringify(r.data && [r.data.jumlah, r.data.nominal]) + ')');
    ok(r.data.mutasi.nSisaDebit === 3 && r.data.mutasi.sisaDebit.some(d => d.nom === 999000), 'transfer bank tanpa pengajuan dilaporkan (' + (r.data.mutasi && r.data.mutasi.nSisaDebit) + ')');
    ok(r.data.dilewati === 3 && r.data.alasanLewat.some(x => /ditutup/.test(x.alasan)) && r.data.alasanLewat.some(x => /tanggal pengajuan/.test(x.alasan)), 'alasan dilewati dicantumkan');
    ok(!B8.Transaksi.some(x => x[1] === 'D009'), 'simulasi tidak menulis apa pun');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, mutasi: M1 });
    ok(r.data.jumlah === 4 && r.data.nominal === 2900000 && r.data.perPeriode.length === 2 && r.data.saldo.every(x => typeof x.saldo_sesudah === 'number'), 'simulasi dengan periode ditutup: 4 baris Rp 2.900.000, saldo per periode dihitung');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, eksekusi: true, jumlah_konfirmasi: 3, mutasi: M1 });
    ok(!r.ok && /Jumlah konfirmasi/.test(r.error) && !B8.Transaksi.some(x => x[1] === 'D009'), 'eksekusi ditolak bila jumlah konfirmasi tidak sama dengan simulasi');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, eksekusi: true, jumlah_konfirmasi: 4, mutasi: M1 });
    ok(r.ok && r.data.dibuat === 4 && r.data.nominal === 2900000, 'eksekusi: 4 transaksi dibuat (' + (r.error || '') + ')');
    const tx9 = B8.Transaksi.filter(x => x[1] === 'D009');
    const byItem = Object.fromEntries(tx9.map(x => [x[14], x]));
    ok(byItem['PZ1-1'][2] === '2026-09-10' && byItem['PZ1-1'][8] === 1500000 && byItem['PZ1-1'][9] === 1500000 && byItem['PZ1-1'][13] === 'P0' && byItem['PZ2-1'][2] === '2026-10-05',
      'tanggal transaksi = tanggal pengajuan; riil & anggaran = nominal pengajuan; periode sesuai');
    ok(String(byItem['PZ1-1'][3]) === 'NOTA-7' && byItem['PZ1-1'][10] === 'https://nota/7', 'bahan baku memakai nomor & foto nota pengajuan');
    ok(byItem['PZ2-1'][3] === 'S9-20261005-001' && byItem['PZ2-2'][3] === 'S9-20261005-002' && byItem['PZ2-2'][10] === '', 'nomor nota kembar → nomor otomatis; bukti dikosongkan (' + JSON.stringify([byItem['PZ2-2'][3], byItem['PZ2-2'][10], byItem['PZ2-1'][3]]) + ')');
    ok(byItem['PZ1-2'][3] === 'S9-20260910-001' && byItem['PZ1-2'][10] === '' && byItem['PZ1-2'][4] === 'Operasional', 'operasional: nomor otomatis per tanggal, bukti kosong');
    const st = Object.fromEntries(B8.PengajuanItem.filter(x => x[2] === 'D009').map(x => [x[0], [x[14], x[19]]]));
    ok(st['PZ1-1'][0] === 'TEREALISASI' && st['PZ1-1'][1] === byItem['PZ1-1'][0] && st['PZ3-1'][0] === 'DISETUJUI' && st['PZ3-1'][1] === '', 'baris yang direalisasi ditautkan; baris yang dilewati tetap DISETUJUI');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, mutasi: M1 });
    ok(r.data.jumlah === 0, 'diulang: tidak ada yang tersisa (tidak dobel)');
    // pemulihan: transaksi sudah ada tapi baris pengajuan belum bertanda (mis. proses terputus) → hanya ditautkan, tidak dibuat dua kali
    const pz = B8.PengajuanItem.find(x => x[0] === 'PZ2-1'); pz[14] = 'DISETUJUI'; pz[19] = '';
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, mutasi: M1 });
    ok(r.data.jumlah === 0 && r.data.sudahTertaut === 1, 'transaksi yang sudah ada dikenali (ditautkan ulang, bukan digandakan)');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', sertakan_tutup: true, eksekusi: true, jumlah_konfirmasi: 0, mutasi: M1 });
    ok(r.ok && r.data.dibuat === 0 && r.data.ditautkanUlang === 1 && pz[14] === 'TEREALISASI' && B8.Transaksi.filter(x => x[1] === 'D009').length === 6, 'pemulihan menautkan tanpa menambah transaksi (' + JSON.stringify([r.error, r.data && r.data.dibuat, B8.Transaksi.filter(x => x[1] === 'D009').length]) + ')');
  }


  // ── Realisasi massal: biaya admin antarbank sesuai bank VA dapur; rekomendasi bank VA ──
  {
    const tAd = tk8('adm');
    lpdhSheetIsi: { const row = ['D009', '', '', '', '', '', '', '', 'BNI']; B8.IdentitasLPDH = B8.IdentitasLPDH || [['dapur_id']]; B8.IdentitasLPDH.push(row); }
    B8.Pengajuan.push(['PZ5', 'BA-PZ5', 'D009', 'P9', '2026-10-06', 'SELESAI', '', 'U2', '', 'U3']);
    const it5 = (id, bank, nom) => B8.PengajuanItem.push([id, 'PZ5', 'D009', 'P9', 1, 'Operasional', 'Gas', 'Gas ' + id, nom, 'pn1', 'Toko', bank, '1', 'TIDAK', 'DISETUJUI', '', 1, '', 'U3', '', '', '', '', '', '']);
    it5('PZ5-1', 'BRI', 200000); it5('PZ5-2', 'Bank Negara Indonesia (BNI)', 300000);
    it5('PZ5-3', 'BNI', 450000); it5('PZ5-4', 'BRI', 120000);
    const M2 = { saldoAwal: 25000000, saldoAkhir: 0, debit: [{ tgl: '2026-10-06', nom: 200000, rek: '1', fee: 6500 }, { tgl: '2026-10-07', nom: 300000, rek: '1', fee: 0 }, { tgl: '2026-10-06', nom: 120000, rek: '777', fee: 6500 }] };
    let r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', mutasi: M2 });
    ok(r.data.jumlah === 2 && r.data.admin === 6500 && r.data.nAdmin === 1, 'simulasi: biaya admin = potongan nyata di mutasi (bukan tebakan bank)');
    ok(r.data.mutasi.nTanpaMutasi === 1 && r.data.mutasi.tanpaMutasi[0].id === 'PZ5-3' && r.data.mutasi.nRekBeda === 1 && r.data.mutasi.rekBeda[0].id === 'PZ5-4',
      'pengajuan tanpa transfer di mutasi & rekening tujuan berbeda TIDAK direalisasi, dilaporkan terpisah');
    ok(r.data.cekSaldo && typeof r.data.cekSaldo.selisih === 'number', 'cek saldo aplikasi vs mutasi pada tanggal terakhir mutasi');
    r = call(e8, 'POST', { action: 'realisasiMassal', token: tAd, dapur: 'D009', eksekusi: true, jumlah_konfirmasi: 2, mutasi: M2 });
    const fee = B8.Transaksi.filter(x => x[14] === 'ADMIN:PZ5-1'), fee2 = B8.Transaksi.filter(x => x[14] === 'ADMIN:PZ5-2');
    ok(r.ok && r.data.admin === 6500 && fee.length === 1 && fee[0][5] === 'Biaya Admin Bank' && fee[0][8] === 6500 && fee[0][2] === '2026-10-06' && fee2.length === 0,
      'eksekusi: transaksi biaya admin terpisah bertanggal sama, hanya untuk antarbank');
    r = call(e8, 'POST', { action: 'getBankVA', token: tk8('akn') });
    ok(r.ok && r.data.fee === 6500 && 'bank' in r.data, 'rekomendasi biaya admin: bank VA dapur tersedia untuk form');
  }

  // ── Realisasi otomatis saat persetujuan, rencana_riil, bukti wajib, biaya_admin, potong VA, Rencana Ops & Realisasi Massal langsung ──
  {
    const ea = makeEnv([
      ['U1', 'adm', 'passwd1', 'Admin', 'admin', '', 'YA'],
      ['U2', 'akn1', 'passwd2', 'Akuntan 1', 'akuntan', 'D001', 'YA'],
      ['U3', 'yay', 'passwd3', 'Yayasan', 'yayasan', '', 'YA'],
    ]);
    const BA = ea.__book;
    BA.Dapur.push(['D002', 'SPPG Dua', '', 'S2']);
    BA.Setup = [
      ['id', 'dapur', 'no', 'mulai', 'akhir', 'penerima', 'va', 'petty', 'status'],
      ['P1', 'D001', 1, '2026-10-01', '2026-10-31', 100, 1000000, 0, 'AKTIF'],
      ['P2', 'D002', 1, '2026-10-01', '2026-10-31', 100, 2000000, 0, 'AKTIF'],
      ['P2OLD', 'D002', 0, '2026-09-01', '2026-09-30', 100, 1000000, 0, 'DITUTUP'],
    ];
    BA.Penerima.push(['pn2', 'Yayasan Mitra', 'BNI', '999', 'YA']);
    const loginA = (u, p) => call(ea, 'POST', { action: 'login', username: u, password: p }).data.token;
    const tAdm = loginA('adm', 'passwd1'), tAkn = loginA('akn1', 'passwd2'), tYay = loginA('yay', 'passwd3');

    // 1. Validasi rencana_riil & bukti/nota wajib saat pengajuan
    let r = call(ea, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-10', items: [
      { jenis: 'Operasional', kategori: 'Asuransi kecelakaan kerja (BPJS) relawan', uraian: 'BPJS Okt', nominal: 200000, penerima_id: 'pn1', nota_url: 'https://drive.google.com/bpjs' },
    ] });
    ok(!r.ok && /rencana realisasi/.test(r.error), 'BPJS masuk Operasional Lainnya: wajib rencana_riil');

    r = call(ea, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-10', items: [
      { jenis: 'Operasional', kategori: 'Asuransi kecelakaan kerja (BPJS) relawan', uraian: 'BPJS Okt', nominal: 200000, rencana_riil: 185000, penerima_id: 'pn1' },
    ] });
    ok(!r.ok && /bukti \/ nota pengajuan wajib/.test(r.error), 'Operasional non-kuitansi wajib unggah bukti/nota saat pengajuan: ' + (r.error || ''));

    r = call(ea, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-10', items: [
      { jenis: 'Operasional', kategori: 'Gaji/honor relawan pekerja SPPG', uraian: 'Honor', nominal: 100000, penerima_id: 'pn1' },
    ] });
    ok(!r.ok && /bukti \/ nota pengajuan wajib/.test(r.error), 'Honor relawan wajib unggah bukti/nota saat pengajuan: ' + (r.error || ''));

    // 2. Pengajuan lengkap: Gas (aktual beda + biaya_admin), BPJS (aktual beda), Honor relawan (realisasi = anggaran), Insentif PIC (kuitansi otomatis, realisasi = anggaran), Sewa Gedung (kuitansi otomatis, realisasi = anggaran)
    r = call(ea, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-10', items: [
      { jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas 12kg', nominal: 200000, rencana_riil: 170000, biaya_admin: 6500, nota_url: 'https://drive.google.com/gas1', nota_no: 'GAS-01', penerima_id: 'pn1' },
      { jenis: 'Operasional', kategori: 'Asuransi kecelakaan kerja (BPJS) relawan', uraian: 'BPJS', nominal: 150000, rencana_riil: 140000, nota_url: 'https://drive.google.com/bpjs1', penerima_id: 'pn1' },
      { jenis: 'Operasional', kategori: 'Gaji/honor relawan pekerja SPPG', uraian: 'Honor 10 Okt', nominal: 100000, nota_url: 'https://drive.google.com/honor1', penerima_id: 'pn1' },
      { jenis: 'Operasional', kategori: 'Insentif Guru/PIC Sekolah', uraian: 'Insentif PIC', nominal: 100000, penerima_id: 'pn1' },
      { jenis: 'Fasilitas SPPG', kategori: 'Sewa Gedung', uraian: 'Sewa Okt', nominal: 250000, penerima_id: 'pn2' },
    ] });
    ok(r.ok, 'pengajuan campuran (aktual beda + realisasi sama + kuitansi + biaya admin) diterima: ' + (r.error || ''));
    const pid = r.data.id;
    const itemsA = BA.PengajuanItem.filter(x => x[1] === pid);
    ok(itemsA.length === 5 && itemsA[0][25] === 170000 && itemsA[0][26] === 6500 && itemsA[2][25] === 100000, 'rencana_riil & biaya_admin tersimpan di PengajuanItem');

    // 3. Cek VA saat persetujuan: total anggaran + biaya admin = 806.500 (<= 1.000.000) → berhasil dan langsung TEREALISASI!
    const nK0 = ea.__kuitansi.length;
    r = call(ea, 'POST', { action: 'decidePengajuan', token: tYay, pengajuan_id: pid, keputusan: itemsA.map(x => ({ item_id: x[0], status: 'DISETUJUI' })) });
    ok(r.ok, 'Yayasan menyetujui semua baris: ' + (r.error || ''));
    ok(itemsA.every(x => x[14] === 'TEREALISASI' && !!x[19]), 'semua baris langsung TEREALISASI & bertaut ke transaksi');
    const txGas = BA.Transaksi.find(t => t[14] === itemsA[0][0]);
    const txFee = BA.Transaksi.find(t => t[14] === 'ADMIN:' + itemsA[0][0]);
    const txBpjs = BA.Transaksi.find(t => t[14] === itemsA[1][0]);
    const txHon = BA.Transaksi.find(t => t[14] === itemsA[2][0]);
    const txPic = BA.Transaksi.find(t => t[14] === itemsA[3][0]);
    const txSew = BA.Transaksi.find(t => t[14] === itemsA[4][0]);
    ok(txGas && txGas[8] === 170000 && txGas[9] === 200000 && txGas[3] === 'GAS-01' && txGas[10] === 'https://drive.google.com/gas1', 'Gas: riil=rencana_riil (170k), unriil=anggaran (200k), no_bukti=nota_no');
    ok(txFee && txFee[5] === 'Biaya Admin Bank' && txFee[8] === 6500 && txFee[9] === 6500, 'biaya_admin otomatis membuat transaksi Biaya Admin Bank terpisah (6.500)');
    ok(txBpjs && txBpjs[8] === 140000 && txBpjs[9] === 150000, 'BPJS: riil=140k, unriil=150k');
    ok(txHon && txHon[8] === 100000 && txHon[9] === 100000, 'Honor relawan: riil = anggaran (100k)');
    ok(txPic && txPic[8] === 100000 && txPic[9] === 100000 && /^https:\/\/drive\.google\.com\/kuitansi\//.test(txPic[10]), 'Insentif PIC: riil = anggaran & kuitansi PDF dibuat otomatis');
    ok(txSew && txSew[8] === 250000 && txSew[9] === 250000 && /^https:\/\/drive\.google\.com\/kuitansi\//.test(txSew[10]) && ea.__kuitansi.length === nK0 + 2, 'Sewa Gedung: riil = anggaran & kuitansi PDF dibuat otomatis');

    // 4. Saldo VA terpotong sebesar Nilai Pengajuan (anggaran) + Biaya Admin = 806.500 → sisa VA = 193.500 (BUKAN berdasarkan riil 766.500!)
    const ap = call(ea, 'GET', { action: 'getActivePeriode', token: tAkn, dapur: 'D001' });
    ok(ap.ok && ap.data.sisaVA === 193500, 'sisa VA terpotong anggaran + biaya admin (1.000.000 - 806.500 = 193.500, dapat ' + (ap.data && ap.data.sisaVA) + ')');
    const dash = call(ea, 'GET', { action: 'getDashboard', token: tAkn, scope: 'D001' });
    ok(dash.ok && dash.data.kpi.sisaVA === 193500 && dash.data.kpi.vaTersedia === 193500, 'Dashboard sisaVA & vaTersedia memakai anggaran + biaya admin (193.500)');

    // 5. Persetujuan yang melebihi VA tersedia atau melebihi pagu: ditolak bila tanpa catatan, tetapi BISA disetujui bila diberi catatan persetujuan
    r = call(ea, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-11', items: [
      { jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas besar', nominal: 190000, rencana_riil: 100000, biaya_admin: 6500, nota_url: 'https://drive.google.com/gas2', penerima_id: 'pn1',
        catatan: 'Melebihi pagu harian Rp 50.000. Alasan: rapel' },
    ] });
    const pjOverId = r.data.id;
    const itOver = BA.PengajuanItem.find(x => x[1] === pjOverId);
    r = call(ea, 'POST', { action: 'decidePengajuan', token: tYay, pengajuan_id: pjOverId, keputusan: [{ item_id: itOver[0], status: 'DISETUJUI' }] });
    ok(!r.ok && /(melebihi pagu|VA tersedia tidak cukup)/.test(r.error), 'persetujuan tanpa catatan ditolak saat melebihi pagu / VA tersedia: ' + (r.error || ''));
    r = call(ea, 'POST', { action: 'decidePengajuan', token: tYay, pengajuan_id: pjOverId, keputusan: [{ item_id: itOver[0], status: 'DISETUJUI', catatan: 'Disetujui PIC: rapel periode sebelumnya' }] });
    ok(r.ok && itOver[14] === 'TEREALISASI' && /Catatan persetujuan: Disetujui PIC/.test(itOver[15]) && /Catatan akuntan: Melebihi pagu/.test(itOver[15]),
      'persetujuan yang melebihi pagu / VA tersedia berhasil disetujui dengan catatan persetujuan: ' + itOver[15]);

    // 6. updateTransaksi: riil hanya bisa diedit untuk Operasional Lainnya & fee row, terkunci untuk Honor/Insentif/Sewa
    r = call(ea, 'POST', { action: 'updateTransaksi', token: tAkn, id: txHon[0], riil: 90000 });
    ok(r.ok && txHon[8] === 100000, 'edit Honor relawan: nilai riil terkunci = anggaran (tetap 100.000)');
    r = call(ea, 'POST', { action: 'updateTransaksi', token: tAkn, id: txGas[0], riil: 175000 });
    ok(r.ok && txGas[8] === 175000 && txGas[9] === 200000, 'edit Gas: nilai riil boleh diubah (175k), anggaran tetap 200k');

    // 7. deleteTransaksi → baris pengajuan jadi DIBATALKAN & biaya admin terkait ikut terhapus
    r = call(ea, 'POST', { action: 'deleteTransaksi', token: tAkn, id: txGas[0] });
    ok(r.ok && itemsA[0][14] === 'DIBATALKAN' && !BA.Transaksi.some(t => t[14] === 'ADMIN:' + itemsA[0][0]), 'hapus transaksi linked → item jadi DIBATALKAN & biaya admin terkait ikut terhapus');

    // 8. saveRencanaOps menyimpan rencana_riil, nota_url, nota_no, biaya_admin
    r = call(ea, 'POST', { action: 'saveRencanaOps', token: tAkn, data: { versi: 0, setelan: { indeks: 100, batas: 95 }, hari: {}, items: [
      { id: 'R1', tanggal: '2026-10-12', kategori: 'Gas', uraian: 'Gas rencana', nominal: 200000, rencana_riil: 180000, nota_url: 'https://drive.google.com/r1', nota_no: 'RN-1', biaya_admin: 6500, penerima_id: 'pn1' },
    ] } });
    ok(r.ok, 'saveRencanaOps dengan rencana_riil, nota_url, nota_no, biaya_admin tersimpan: ' + (r.error || ''));
    r = call(ea, 'GET', { action: 'getRencanaOps', token: tAkn });
    const ro1 = r.data.rencana.items[0];
    ok(ro1 && ro1.rencana_riil === 180000 && ro1.nota_url === 'https://drive.google.com/r1' && ro1.nota_no === 'RN-1' && ro1.biaya_admin === 6500, 'Rencana Ops membaca kembali rencana_riil, nota_url, nota_no, biaya_admin');

    // 9. Realisasi Massal langsung (tanpa_mutasi: true) untuk tunggakan lama — satu dapur maupun ALL dapur sekaligus
    BA.IdentitasLPDH = [['dapur_id', 'id_sppg', 'nama_sppg', 'alamat', 'kel', 'kec', 'yayasan', 'no_va', 'bank'], ['D001', '', '', '', '', '', '', '', 'BNI'], ['D002', '', '', '', '', '', '', '', 'BNI']];
    BA.Pengajuan.push(['PL1', 'BA-PL1', 'D001', 'P1', '2026-10-08', 'SELESAI', '', 'U2', '', 'U3']);
    BA.Pengajuan.push(['PL2', 'BA-PL2', 'D002', 'P2', '2026-10-09', 'SELESAI', '', 'U2', '', 'U3']);
    BA.Pengajuan.push(['PL3', 'BA-PL3', 'D002', 'P2OLD', '2026-09-20', 'SELESAI', '', 'U2', '', 'U3']);
    BA.PengajuanItem.push(
      ['PL1-1', 'PL1', 'D001', 'P1', 1, 'Operasional', 'Gas', 'Tunggakan D1', 50000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI', '', 1, '', 'U3', '', '', '', '', '', ''],
      ['PL2-1', 'PL2', 'D002', 'P2', 1, 'Bahan Baku', 'Semua Kategori', 'Tunggakan D2', 120000, 'pn2', 'Yayasan Mitra', 'BNI', '999', 'TIDAK', 'DISETUJUI', '', 1, '', 'U3', '', '', '', '', 'https://nota/d2', 'NT-D2'],
      ['PL3-1', 'PL3', 'D002', 'P2OLD', 1, 'Operasional', 'Listrik', 'Tunggakan D2 lama', 80000, 'pn1', 'Toko A', 'BCA', '123', 'TIDAK', 'DISETUJUI', '', 1, '', 'U3', '', '', '', '', '', '']
    );
    r = call(ea, 'POST', { action: 'realisasiMassal', token: tAdm, dapur: 'ALL', tanpa_mutasi: true, sertakan_tutup: false, catat_admin: true });
    ok(r.ok && r.data.tanpaMutasi && r.data.jumlah === 2 && r.data.nominal === 170000 && r.data.admin === 6500 && r.data.nAdmin === 1, 'simulasi langsung ALL (periode aktif): 2 baris, 1 antarbank Rp 6.500 (' + JSON.stringify(r.data && [r.data.jumlah, r.data.nominal, r.data.admin]) + ')');
    r = call(ea, 'POST', { action: 'realisasiMassal', token: tAdm, dapur: 'ALL', tanpa_mutasi: true, sertakan_tutup: true, catat_admin: true });
    ok(r.ok && r.data.jumlah === 3 && r.data.nominal === 250000 && r.data.admin === 13000 && r.data.nAdmin === 2, 'simulasi langsung ALL (+ periode ditutup): 3 baris Rp 250k + 2 admin Rp 13k');
    r = call(ea, 'POST', { action: 'realisasiMassal', token: tAdm, dapur: 'ALL', tanpa_mutasi: true, sertakan_tutup: true, catat_admin: false });
    ok(r.ok && r.data.jumlah === 3 && r.data.admin === 0 && r.data.nAdmin === 0, 'simulasi langsung tanpa catat admin: admin = 0');
    r = call(ea, 'POST', { action: 'realisasiMassal', token: tAdm, dapur: 'ALL', tanpa_mutasi: true, sertakan_tutup: true, catat_admin: true, eksekusi: true, jumlah_konfirmasi: 3 });
    ok(r.ok && r.data.dibuat === 3 && r.data.nAdmin === 2 && r.data.admin === 13000, 'eksekusi langsung ALL: 3 transaksi + 2 biaya admin dibuat');
    ok(BA.PengajuanItem.filter(x => ['PL1-1', 'PL2-1', 'PL3-1'].includes(x[0])).every(x => x[14] === 'TEREALISASI' && !!x[19]), 'semua tunggakan lama di semua dapur berstatus TEREALISASI');
    r = call(ea, 'POST', { action: 'realisasiMassal', token: tAdm, dapur: 'ALL', tanpa_mutasi: true, sertakan_tutup: true });
    ok(r.ok && r.data.jumlah === 0, 'setelah realisasi langsung ALL: 0 tunggakan tersisa');
  }

  // 24. Pengajuan backdate: wajib ACC Admin dulu sebelum masuk ke persetujuan PIC/Yayasan
  {
    const eb = makeEnv([
      ['U1', 'adm', 'AdmPass1', 'Admin Utama', 'admin', '', 'YA'],
      ['U2', 'akn', 'AknPass1', 'Akuntan D1', 'akuntan', 'D001', 'YA'],
      ['U3', 'pic', 'PicPass1', 'PIC D1', 'pic', 'D001', 'YA'],
      ['U4', 'yys', 'YysPass1', 'Yayasan', 'yayasan', '', 'YA'],
    ]);
    eb.__today = '2026-10-15';
    const tokB = (u, p) => call(eb, 'POST', { action: 'login', username: u, password: p }).data.token;
    const tAdm = tokB('adm', 'AdmPass1'), tAkn = tokB('akn', 'AknPass1'), tPic = tokB('pic', 'PicPass1'), tYys = tokB('yys', 'YysPass1');
    const itemGas = { jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas backdate', nominal: 100000, rencana_riil: 100000, penerima_id: 'pn1', nota_url: 'https://drive.google.com/nota-bd1' };

    // 1. Akuntan ajukan backdate (2026-10-10 < today 2026-10-15)
    let r = call(eb, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-10', items: [itemGas] });
    ok(r.ok && r.data.backdate === true, 'createPengajuan backdate diterima dan ditandai backdate=true');
    const pid1 = r.data.id;

    // 2. PIC & Yayasan tidak melihat pengajuan backdate di tab Menunggu
    r = call(eb, 'POST', { action: 'getPengajuan', token: tPic, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan.length === 0, 'PIC tidak melihat pengajuan backdate sebelum di-ACC Admin');
    r = call(eb, 'POST', { action: 'getPengajuan', token: tYys, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan.length === 0, 'Yayasan tidak melihat pengajuan backdate sebelum di-ACC Admin');

    // 3. PIC / Yayasan ditolak jika mencoba decidePengajuan langsung atau decideBackdatePengajuan
    const it1Id = pid1 + '-1';
    r = call(eb, 'POST', { action: 'decidePengajuan', token: tPic, pengajuan_id: pid1, keputusan: [{ item_id: it1Id, status: 'DISETUJUI' }] });
    ok(!r.ok && /menunggu ACC Admin/i.test(r.error), 'PIC tidak bisa memutuskan backdate sebelum ACC Admin: ' + r.error);
    r = call(eb, 'POST', { action: 'decideBackdatePengajuan', token: tPic, pengajuan_id: pid1, status: 'DISETUJUI' });
    ok(!r.ok && /Hanya Admin/i.test(r.error), 'PIC tidak boleh memanggil decideBackdatePengajuan');
    r = call(eb, 'POST', { action: 'decideBackdatePengajuan', token: tYys, pengajuan_id: pid1, status: 'DISETUJUI' });
    ok(!r.ok && /Hanya Admin/i.test(r.error), 'Yayasan tidak boleh memanggil decideBackdatePengajuan');

    // 4. Admin melihat pengajuan backdate di tab Menunggu dengan status MENUNGGU_ADMIN
    r = call(eb, 'POST', { action: 'getPengajuan', token: tAdm, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan.length === 1 && r.data.pengajuan[0].status === 'MENUNGGU_ADMIN', 'Admin melihat backdate berstatus MENUNGGU_ADMIN di tab Menunggu');

    // 5. Akuntan masih bisa edit baris saat MENUNGGU_ADMIN dan status tetap MENUNGGU_ADMIN
    r = call(eb, 'POST', { action: 'updatePengajuanItem', token: tAkn, item_id: it1Id, jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas backdate revisi', nominal: 110000, rencana_riil: 110000, penerima_id: 'pn1', nota_url: 'https://drive.google.com/nota-bd1' });
    ok(r.ok, 'Akuntan bisa edit baris saat MENUNGGU_ADMIN');
    r = call(eb, 'POST', { action: 'getPengajuan', token: tAdm, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan[0].status === 'MENUNGGU_ADMIN' && r.data.pengajuan[0].items[0].nominal === 110000, 'setelah edit status tetap MENUNGGU_ADMIN');

    // 6. Admin ACC backdate → status berubah ke MENUNGGU / DIAJUKAN (belum buat transaksi)
    r = call(eb, 'POST', { action: 'decideBackdatePengajuan', token: tAdm, pengajuan_id: pid1, status: 'DISETUJUI', catatan: 'Nota fisik sudah dicek' });
    ok(r.ok && r.data.status === 'DIAJUKAN', 'Admin ACC backdate berhasil → DIAJUKAN');
    ok(eb.__book.Transaksi.length === 1, 'ACC Admin belum membuat transaksi / memotong VA');

    // 7. Sekarang PIC melihat pengajuan di tab Menunggu dan dapat menyetujuinya → TEREALISASI pada tanggal backdate
    r = call(eb, 'POST', { action: 'getPengajuan', token: tPic, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan.length === 1 && r.data.pengajuan[0].status === 'MENUNGGU', 'setelah ACC Admin, PIC melihat pengajuan di tab Menunggu');
    r = call(eb, 'POST', { action: 'decidePengajuan', token: tPic, pengajuan_id: pid1, keputusan: [{ item_id: it1Id, status: 'DISETUJUI' }] });
    ok(r.ok && r.data.terealisasi === 1, 'PIC berhasil menyetujui pengajuan backdate setelah ACC Admin');
    const txBd = eb.__book.Transaksi[1];
    ok(txBd && txBd[2] === '2026-10-10' && txBd[8] === 110000, 'transaksi backdate tercatat pada tanggal 2026-10-10');

    // 8. Admin menolak backdate (wajib catatan)
    r = call(eb, 'POST', { action: 'createPengajuan', token: tAkn, tanggal: '2026-10-11', items: [Object.assign({}, itemGas, { uraian: 'Gas backdate tolak' })] });
    const pid2 = r.data.id;
    r = call(eb, 'POST', { action: 'decideBackdatePengajuan', token: tAdm, pengajuan_id: pid2, status: 'DITOLAK', catatan: '' });
    ok(!r.ok && /wajib/i.test(r.error), 'tolak backdate tanpa alasan ditolak');
    r = call(eb, 'POST', { action: 'decideBackdatePengajuan', token: tAdm, pengajuan_id: pid2, status: 'DITOLAK', catatan: 'Nota tidak valid' });
    ok(r.ok && r.data.status === 'DITOLAK', 'Admin berhasil menolak pengajuan backdate dengan alasan');
    r = call(eb, 'POST', { action: 'getPengajuan', token: tPic, filter: 'menunggu' });
    ok(r.ok && r.data.pengajuan.length === 0, 'pengajuan backdate yang ditolak Admin tidak masuk ke PIC');
  }

  console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
  process.exit(fails ? 1 : 0);
})();
