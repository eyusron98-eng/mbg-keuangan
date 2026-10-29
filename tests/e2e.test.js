// Uji browser (Chromium + Playwright) terhadap index.html dengan API Apps Script TIRUAN — tanpa data asli.
// Jalankan: npm run test:e2e
//   CHROMIUM_PATH=/path/ke/chromium  bila Chromium tidak terpasang lewat Playwright
//   HTML=src/index.html              untuk menguji sumber (mode pengembangan)
//   ONLY="Riwayat"                   hanya uji yang namanya memuat teks ini;  DBG=1  cetak isi halaman saat gagal
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const NM = path.join(__dirname, '..', 'node_modules');
const HTML = process.env.HTML || path.join(__dirname, '..', 'index.html');   // default: hasil build

const MAP = [
  [/unpkg\.com\/react@/, NM + '/react/umd/react.production.min.js'],
  [/unpkg\.com\/react-dom@/, NM + '/react-dom/umd/react-dom.production.min.js'],
  [/unpkg\.com\/prop-types@/, NM + '/prop-types/prop-types.min.js'],
  [/unpkg\.com\/recharts@/, NM + '/recharts/umd/Recharts.js'],
  [/unpkg\.com\/xlsx@/, NM + '/xlsx/dist/xlsx.full.min.js'],
  [/unpkg\.com\/@babel\/standalone@/, NM + '/@babel/standalone/babel.min.js'],
];

const P1 = { id: 'P1', periode_no: 1, dapur: 'D1', status: 'DITUTUP', tanggal_mulai: '2026-09-01', tanggal_akhir: '2026-09-30', penerima: 100, saldoVA: 10000000, saldoPettyAwal: 0 };
const P2 = { id: 'P2', periode_no: 2, dapur: 'D1', status: 'AKTIF', tanggal_mulai: '2026-10-01', tanggal_akhir: '2026-10-31', penerima: 100, saldoVA: 7000000, saldoPettyAwal: 0,
  sisaVA: 7000000, sisaPetty: 0, totalVATopup: 0, totalPettyTopup: 0, pengeluaranVA: 0, pengeluaranPetty: 0 };
const ITEM = { id: 'i1', urut: 1, jenis: 'Bahan Baku', kategori: 'Beras', uraian: 'Beras 50 kg', nominal: 600000, penerima_id: 'pn1', status: 'DIAJUKAN', susulan: false };

function makeServer(opts) {
  const log = { urls: [], posts: [], createCount: 0, lazy: [] };
  function handle(action, p, isPost) {
    switch (action) {
      case 'login': return { ok: true, data: { token: 'tok', user: { id: 'u1', nama: 'Siti', username: p.username, role: opts.role, dapur: (opts.role === 'akuntan' || opts.role === 'pic') ? 'D1' : '' } } };
      case 'getDapur': return { ok: true, data: [{ id: 'D1', nama: 'SPPG Satu', kode: 'S1' }, { id: 'D2', nama: 'SPPG Dua', kode: 'S2' }] };
      case 'getPeriodeList': return { ok: true, data: p.scope === 'D2' ? [{ id: 'P9', periode_no: 3, dapur: 'D2', status: 'AKTIF', tanggal_mulai: '2026-10-05', tanggal_akhir: '2026-10-25', penerima: 50, saldoVA: 3000000, saldoPettyAwal: 0 }] : [P1, P2] };
      case 'getActivePeriode': return { ok: true, data: P2 };
      case 'getVATopups': return { ok: true, data: [{ id: 'v1', periode_id: 'P1', jumlah: 1000000, tanggal: '2026-09-10', keterangan: '' }] };
      case 'getPettyTopups': return { ok: true, data: [] };
      case 'getPenandatangan': return { ok: true, data: { akuntan: 'Budi Akuntan' } };
      case 'getTransaksi':
        if (opts.riwayat && p.periode_id === 'P2') return { ok: true, data: [
          { id: 'tOps', dapur: 'D1', tanggal: '2026-10-02', no_bukti: 'OPS-1', jenis: 'Operasional', kategori: 'Gas', uraian: 'Gas 12 kg', sumber: 'VA', riil: 100000, unriil: 100000, seq: 1 },
          { id: 'tBB', dapur: 'D1', tanggal: '2026-10-03', no_bukti: 'BB-1', jenis: 'Bahan Baku', kategori: 'Beras', uraian: 'Beras 20 kg', sumber: 'VA', riil: 200000, unriil: 200000, seq: 2 } ] };
        return { ok: true, data: (p.periode_id === 'P1' || opts.laporan) ? [{ id: 't1', sumber: 'VA', riil: 3000000, unriil: 3000000, tanggal: '2026-09-12', jenis: 'Bahan Baku', kategori: 'Beras', uraian: 'x', no_bukti: 'N1' }] : [] };
      case 'getKategori': return { ok: true, data: opts.riwayat ? { 'Bahan Baku': ['Beras'], 'Operasional': ['Gas', 'Listrik'] } : { 'Bahan Baku': ['Beras'] } };
      case 'getPenerima': return { ok: true, data: [{ id: 'pn1', nama: 'Toko A', bank: 'BCA', no_rek: '123', aktif: true }] };
      case 'getBADaftar': {
        const d = new Date(), pd = n => (n < 10 ? '0' : '') + n, today = d.getFullYear() + '-' + pd(d.getMonth() + 1) + '-' + pd(d.getDate());
        const g = (nomor, tanggal, periode_id, st) => ({ dapur: 'D1', tanggal, nomor, periode_id, periode_no: periode_id === 'P1' ? 1 : 2, periode_status: st, periode_mulai: '', periode_akhir: '', pengajuan: 1, menunggu: 0, disetujui: 1, total: 100000 });
        return { ok: true, data: [g('BA-HARIINI', today, 'P2', 'AKTIF'), g('BA-AKTIF-LAIN', '2026-10-02', 'P2', 'AKTIF'), g('BA-LAMA', '2026-09-10', 'P1', 'DITUTUP')] };
      }
      case 'getPengajuan': {
        const d = new Date(), pd = n => (n < 10 ? '0' : '') + n, today = d.getFullYear() + '-' + pd(d.getMonth() + 1) + '-' + pd(d.getDate());
        const head = (id, nomor, dapur, tanggal, status, items) => ({ id, nomor, dapur, tanggal, status, created_at: tanggal + 'T08:00:00', created_by_nama: 'Siti', total_diajukan: 600000, total_disetujui: status === 'SELESAI' ? 600000 : 0, items });
        const rng = { D1: { mulai: '2026-10-01', akhir: '2026-10-31' }, D2: { mulai: '2026-10-05', akhir: '2026-10-25' } };
        if (p.periode_id === 'P1') return { ok: true, data: { pengajuan: [head('gold', 'BA-LAMA-PJ', 'D1', '2026-09-10', 'MENUNGGU', [Object.assign({}, ITEM, { id: 'iold', uraian: 'Gula lama' })])], va: {}, periodeAktif: { D1: 'P2' }, periodeRange: rng } };
        const list = [];
        if (opts.existing) list.push(head('g1', 'BA-PA/S1/2026/10/001', 'D1', opts.tanggal, 'MENUNGGU', [ITEM]));
        if (opts.multi) list.push(head('g2', 'BA-PA/S2/2026/10/009', 'D2', today, 'MENUNGGU', [Object.assign({}, ITEM, { id: 'i2', uraian: 'Telur 20 kg' })]));
        return { ok: true, data: { pengajuan: list, va: { D1: { sisaVA: 7000000, komitmen: 0, tersedia: 7000000 }, D2: { sisaVA: 5000000, komitmen: 0, tersedia: 5000000 } }, periodeAktif: { D1: 'P2', D2: 'P9' }, periodeRange: rng } };
      }
      case 'createPengajuan': log.createCount++; return { ok: true, data: { nomor: 'BA-PA/S1/2026/10/00' + (log.createCount + 1) } };
      case 'getDashboard': return { ok: true, data: { hasActivePeriode: true, periode: P2, kpi: { penerima: 100, sisaVA: 7000000, saldoVATotal: 7000000, sisaPetty: 0, saldoPettyTotal: 0, totalRiil: 0, totalUnriil: 0, selisihAnggaran: 0, serap: 0, komitmen: 0, komitmenCount: 0, menungguNominal: 0, menungguCount: 0, vaTersedia: 7000000, daruratCount: 0 }, kategoriByJenis: {}, byDay: opts.grafik ? [{ tanggal: '01/10', value: 150000 }, { tanggal: '02/10', value: 90000 }] : [] } };
      case 'getUsers': return { ok: true, data: [{ id: 'u1', nama: 'Siti', username: 'siti', password: 'RAHASIA-PLAINTEXT', role: 'admin', dapur: '', aktif: 'YA' }] };
      default: return { ok: true, data: [] };
    }
  }
  return { log, handle };
}

async function run(name, opts, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return true;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const srv = makeServer(opts);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    for (const [re, file] of MAP) if (re.test(url)) { srv.log.lazy.push(url); return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) }); }
    if (/cdn\.tailwindcss\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });   // hanya src/index.html; tanpa CSS
    if (/script\.google\.com/.test(url)) {
      const req = route.request();
      let action, params;
      if (req.method() === 'POST') { params = JSON.parse(req.postData()); action = params.action; srv.log.posts.push({ action, params }); }
      else { const u = new URL(url); params = Object.fromEntries(u.searchParams); action = params.action; srv.log.urls.push(url); }
      let out = opts.override && opts.override(action, req.method(), params);
      if (!out) out = srv.handle(action, params, req.method() === 'POST');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    }
    return route.abort();
  });
  await page.goto('file://' + HTML);
  let ok = true, msg = '';
  try { await fn(page, srv); } catch (e) { ok = false; msg = e.message.split('\n').slice(0, 14).join(' | '); if (process.env.DBG) { console.log('---BODY---\n' + (await page.innerText('body')).slice(0, 1500)); } }
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (msg ? ' — ' + msg : ''));
  if (errors.length) console.log('   errors:', errors.slice(0, 5));
  await browser.close();
  return ok;
}

async function login(page, user) {
  await page.fill('input[placeholder="cth. akuntan1"]', user);
  await page.fill('input[type=password]', 'pw-rahasia-1');
  await page.click('text=Masuk >> nth=-1');
}
function assert(c, m) { if (!c) throw new Error(m); }

(async () => {
  let all = true;
  all &= await run('login via POST, password tidak di URL', { role: 'akuntan' }, async (page, srv) => {
    await login(page, 'siti');
        await page.waitForSelector('header');
    assert(srv.log.posts.some(p => p.action === 'login' && p.params.password === 'pw-rahasia-1'), 'login tidak lewat POST');
    assert(!srv.log.urls.some(u => u.includes('pw-rahasia-1') || u.includes('action=login')), 'password/login bocor ke URL GET');
  });

  all &= await run('tidak ada fallback GET: password tidak pernah masuk URL walau POST ditolak', { role: 'akuntan',
    override: (a, m) => (a === 'login' && m === 'POST') ? { ok: false, error: 'Unknown action: login' } : null }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('text=Unknown action');
    assert(!srv.log.urls.some(u => u.includes('action=login') || u.includes('pw-rahasia-1')), 'password bocor ke GET');
  });

  all &= await run('salah password tidak jatuh ke GET', { role: 'akuntan',
    override: (a, m) => (a === 'login') ? { ok: false, error: 'Username atau password salah' } : null }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('text=Username atau password salah');
    assert(!srv.log.urls.some(u => u.includes('action=login')), 'salah password malah dikirim ulang via GET');
  });

  let sesiTolak = 0;
  all &= await run('Sesi: penolakan sesaat setelah login tidak menendang pengguna (dicoba ulang sekali)', { role: 'asisten',
    override: (a) => (a !== 'login' && sesiTolak++ < 1) ? { ok: false, error: 'Sesi tidak valid atau kedaluwarsa. Silakan keluar lalu masuk lagi.' } : null }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.waitForTimeout(3000);
    assert(await page.isVisible('header'), 'pengguna terpental ke layar login');
    assert(!(await page.isVisible('input[type=password]')), 'form login muncul lagi');
  });

  all &= await run('Sesi: bila server tetap menolak, pengguna dikeluarkan dengan pesan', { role: 'asisten',
    override: (a) => a !== 'login' ? { ok: false, error: 'Sesi tidak valid atau kedaluwarsa. Silakan keluar lalu masuk lagi.' } : null }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('input[type=password]', { timeout: 10000 });
    await page.waitForSelector('text=Sesi tidak valid');
  });

  all &= await run('Setup: kartu sinkron saldo + form periode', { role: 'akuntan' }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Setup').catch(async () => { await page.click('nav:visible >> text=Setup'); });
    await page.waitForSelector('text=Sinkron saldo dengan periode sebelumnya');
    const txt = await page.innerText('body');
    assert(/Saldo akhir Periode 1/.test(txt) && txt.includes('Rp 8.000.000'), 'saldo akhir P1 harus Rp 8.000.000 (10jt+1jt-3jt)');
    assert(txt.includes('Rp 7.000.000') && /Selisih/.test(txt), 'saldo awal P2 / selisih tidak tampil');
    assert(txt.includes('1.000.000'), 'selisih 1.000.000 tidak tampil');
    await page.click('text=Samakan dengan saldo akhir Periode 1');
    await page.waitForSelector('text=Alasan perubahan saldo awal *');
    const v = await page.inputValue('input[placeholder="0"] >> nth=1').catch(() => '');
    const modal = await page.innerText('.sheet');
    assert(modal.includes('Saldo akhir Periode 1'), 'info carry tidak tampil di form');
    const vals = await page.$$eval('.sheet input[inputmode=numeric]', els => els.map(e => e.value));
    assert(vals[0] === '8.000.000', 'saldo VA prefill harus 8.000.000, dapat: ' + vals.join(','));
  });

  all &= await run('Dashboard akuntan: banner selisih + "Sudah sesuai" menyembunyikan', { role: 'akuntan' }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('text=tidak sama dengan saldo akhir Periode 1');
    await page.click('text=Sudah sesuai');
    await page.waitForFunction(() => !document.body.innerText.includes('tidak sama dengan saldo akhir Periode 1'));
  });

  const form = async (page, existing) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    await page.click('button:has-text("Buat pengajuan")');
    await page.selectOption('.rounded-lg select >> nth=0', 'Bahan Baku');
    await page.fill('input[placeholder="cth. Beras 50 kg"]', 'Beras 50 kg');
    await page.fill('input[inputmode=numeric]', '600000');
    await page.selectOption('select >> nth=-1', 'pn1');
    await page.click('text=Kirim untuk persetujuan');
    await page.click('.sheet button:text-is("Kirim")');
  };
  const today = new Date(); const pad = n => (n < 10 ? '0' : '') + n;
  const tgl = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

  all &= await run('Pengajuan: kiriman identik tertangkap sebagai duplikat', { role: 'akuntan', existing: true, tanggal: tgl }, async (page, srv) => {
    await form(page);
    await page.waitForSelector('text=Kemungkinan pengajuan ganda');
    assert(srv.log.createCount === 0, 'pengajuan terkirim padahal duplikat');
    await page.click('.sheet button:text-is("Tetap kirim")');
    await page.waitForFunction(() => document.body.innerText.includes('terkirim untuk persetujuan'));
    assert(srv.log.createCount === 1, 'Tetap kirim harus mengirim tepat 1x');
    assert(srv.log.posts.find(p => p.action === 'createPengajuan').params.request_id, 'request_id tidak terkirim');
  });

  all &= await run('Pengajuan: tanpa duplikat langsung terkirim 1x', { role: 'akuntan', existing: false, tanggal: tgl }, async (page, srv) => {
    await form(page);
    await page.waitForFunction(() => document.body.innerText.includes('terkirim untuk persetujuan'));
    assert(srv.log.createCount === 1, 'harus 1x kirim');
  });

  all &= await run('Pengajuan: koneksi putus → peringatan, bukan sukses palsu', { role: 'akuntan', existing: false, tanggal: tgl,
    override: (a, m) => a === 'createPengajuan' ? { ok: false, error: 'Koneksi gagal: Failed to fetch' } : null }, async (page, srv) => {
    await form(page);
    await page.waitForSelector('text=MUNGKIN sudah terkirim');
  });

  all &= await run('Pengguna: password tidak tampil', { role: 'admin' }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengguna');
    await page.waitForSelector('text=Manajemen Pengguna');
    const txt = await page.innerText('body');
    assert(!txt.includes('RAHASIA-PLAINTEXT') && !/tampilkan/.test(txt) && !/^Password$/m.test(txt), 'password masih tampil');
  });


  all &= await run('Periode baru: saldo awal terisi dari saldo akhir, ubah → wajib alasan', { role: 'akuntan',
    override: (a) => a === 'getActivePeriode' ? { ok: true, data: null } : a === 'getPeriodeList' ? { ok: true, data: [P1, Object.assign({}, P2, { status: 'DITUTUP' })] } : null }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Setup');
    await page.waitForSelector('text=Belum ada periode aktif');
    await page.waitForTimeout(800);
    await page.click('text=Buat Periode Baru');
    await page.waitForSelector('text=Terisi otomatis');
    const vals = await page.$$eval('.sheet input[inputmode=numeric]', els => els.map(e => e.value));
    assert(vals[0] === '7.000.000', 'prefill VA harus 7.000.000, dapat: ' + vals.join(','));
    assert(!(await page.innerText('.sheet')).includes('Alasan saldo awal berbeda'), 'alasan tidak boleh muncul sebelum diubah');
    await page.fill('.sheet input[inputmode=numeric] >> nth=0', '9000000');
    await page.waitForSelector('text=Alasan saldo awal berbeda dari saldo akhir periode lalu *');
  });

  for (const role of ['pic', 'admin', 'yayasan']) {
    all &= await run('Persetujuan: ' + role + ' melihat menu & bisa memutuskan', { role, existing: true, tanggal: '2026-10-15',
      override: (a) => a === 'decidePengajuan' ? { ok: true, data: { totalSetuju: 600000 } } : null }, async (page, srv) => {
      await login(page, 'siti');
      await page.waitForSelector('header');
      await page.click('nav:visible >> text=Persetujuan');
      await page.waitForSelector('text=Beras 50 kg');
      await page.click('button:text-is("Setuju")');
      await page.click('text=Kirim keputusan');
      await page.click('.sheet button:text-is("Kirim")');
      await page.waitForFunction(() => document.body.innerText.includes('tersimpan'));
      const d = srv.log.posts.find(p => p.action === 'decidePengajuan');
      assert(d && d.params.keputusan[0].status === 'DISETUJUI', 'keputusan tidak terkirim');
    });
  }
  all &= await run('Persetujuan: akuntan & asisten TIDAK punya menu Persetujuan', { role: 'akuntan' }, async (page) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    const nav = await page.innerText('nav');
    assert(!/Persetujuan/.test(nav), 'akuntan melihat menu Persetujuan');
  });

  all &= await run('Pengajuan: tab terpisah, tombol kirim terlihat tanpa scroll, banner sukses setelah kirim', { role: 'akuntan', existing: true, tanggal: '2026-10-15',
    override: (a) => a === 'createPengajuan' ? { ok: true, data: { nomor: 'BA-PA/S1/2026/10/777' } } : null }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    // default akuntan: tab daftar → daftar terlihat, formulir tidak
    await page.click('button:has-text("Periode aktif")');
    await page.waitForSelector('text=BA-PA/S1/2026/10/001');
    assert(!(await page.isVisible('text=Kirim untuk persetujuan')), 'tombol kirim tidak boleh tampil di tab daftar');
    await page.click('button:has-text("Buat pengajuan")');
    assert(!(await page.isVisible('text=BA-PA/S1/2026/10/001')), 'daftar tidak boleh tampil di tab formulir');
    for (let i = 0; i < 4; i++) await page.click('text=Tambah baris');   // form dibuat panjang
    await page.evaluate(() => window.scrollTo(0, 0));
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('Kirim untuk persetujuan')).getBoundingClientRect(); return { bottom: b.bottom, top: b.top, h: innerHeight, formH: document.body.scrollHeight }; });
    assert(r.formH > r.h * 1.5, 'form harus lebih panjang dari layar agar uji bermakna: ' + JSON.stringify(r));
    assert(r.top >= 0 && r.bottom <= r.h, 'tombol kirim harus terlihat di layar tanpa scroll: ' + JSON.stringify(r));
    // isi 1 baris lengkap, hapus 3 baris kosong lalu kirim
    for (let i = 0; i < 4; i++) await page.click('text=Hapus baris >> nth=-1');
    await page.selectOption('.rounded-lg select >> nth=0', 'Bahan Baku');
    await page.fill('input[placeholder="cth. Beras 50 kg"]', 'Gula 10 kg');
    await page.fill('input[inputmode=numeric]', '150000');
    await page.selectOption('select >> nth=-1', 'pn1');
    await page.click('text=Kirim untuk persetujuan');
    await page.click('.sheet button:text-is("Kirim")');
    await page.waitForSelector('text=Pengajuan terkirim.');
    await page.waitForSelector('text=Kabari Yayasan lewat WhatsApp').catch(() => {});
    await page.waitForSelector('text=Kabari Yayasan lewat WhatsApp');
    await page.click('.sheet button:text-is("Tutup")');   // jendela WA (perilaku lama) menutupi halaman
    assert(await page.isVisible('text=BA-PA/S1/2026/10/001'), 'setelah kirim harus pindah ke daftar');
    assert(!(await page.isVisible('text=Kirim untuk persetujuan')), 'formulir harus tersembunyi setelah kirim');
    await page.click('button:has-text("Buat pengajuan")');
    assert((await page.inputValue('input[placeholder="cth. Beras 50 kg"]')) === '', 'formulir harus kosong lagi setelah kirim');
  });

  all &= await run('Berita Acara: asisten punya menu; default hanya hari ini; periode lain dimuat bila dipilih', { role: 'asisten' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Berita Acara');
    await page.waitForSelector('text=BA-HARIINI');
    let body = await page.innerText('main');
    assert(!body.includes('BA-AKTIF-LAIN') && !body.includes('BA-LAMA'), 'default harus hanya hari ini');
    const u1 = srv.log.urls.filter(u => u.includes('action=getBADaftar')).pop();
    assert(/mode=hari/.test(u1) && /tanggal=\d{4}-\d{2}-\d{2}/.test(u1), 'permintaan harus mode=hari: ' + u1);
    await page.click('button:text-is("Periode aktif")');
    await page.waitForSelector('text=BA-AKTIF-LAIN');
    body = await page.innerText('main');
    assert(body.includes('BA-HARIINI') && !body.includes('BA-LAMA'), 'periode aktif: tanpa periode ditutup');
    await page.click('button:text-is("Periode ditutup")');
    await page.waitForSelector('text=Pilih periode yang sudah ditutup untuk menampilkan');
    const n = srv.log.urls.filter(u => u.includes('action=getBADaftar')).length;
    await page.selectOption('main select:visible', 'P1');
    await page.waitForSelector('text=BA-LAMA');
    body = await page.innerText('main');
    assert(!body.includes('BA-HARIINI') && !body.includes('BA-AKTIF-LAIN'), 'periode ditutup: hanya periode itu');
    const u3 = srv.log.urls.filter(u => u.includes('action=getBADaftar')).pop();
    assert(/mode=periode/.test(u3) && /periode_id=P1/.test(u3), 'permintaan harus mode=periode&periode_id=P1: ' + u3);
    assert(srv.log.urls.filter(u => u.includes('action=getBADaftar')).length === n + 1, 'memilih tab ditutup tidak boleh memuat sebelum periode dipilih');
  });
  all &= await run('Pengajuan: daftar memakai Berita Acara periode aktif saja', { role: 'akuntan', existing: true, tanggal: '2026-10-15' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    await page.click('button:has-text("Periode aktif")');
    await page.waitForSelector('text=BA-PA/S1/2026/10/001');
    const u = srv.log.urls.filter(x => x.includes('action=getBADaftar')).pop();
    assert(/mode=aktif/.test(u), 'getBADaftar di halaman pengajuan harus mode=aktif: ' + u);
  });

  all &= await run('Pengajuan admin: dikelompokkan per dapur, Hari ini/Periode aktif, periode ditutup hanya bila dipilih', { role: 'admin', existing: true, multi: true, tanggal: '2026-10-15' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    await page.waitForSelector('text=BA-PA/S2/2026/10/009');            // hari ini: hanya pengajuan hari H hari ini
    let main = await page.innerText('main');
    assert(!main.includes('BA-PA/S1/2026/10/001'), 'Hari ini tidak boleh menampilkan hari lain');
    await page.click('button:has-text("Periode aktif")');
    await page.waitForSelector('text=BA-PA/S1/2026/10/001');
    main = await page.innerText('main');
    const iSatu = main.indexOf('SPPG Satu'), iDua = main.indexOf('SPPG Dua');
    assert(iSatu >= 0 && iDua >= 0 && iDua < iSatu && (main.match(/Periode aktif · /g) || []).length === 2, 'harus ada judul kelompok per dapur (urut abjad) + info periode masing-masing');
    assert(!main.includes('BA-LAMA-PJ'), 'periode ditutup tidak boleh ikut');
    const n = srv.log.urls.filter(u => u.includes('action=getPengajuan') && u.includes('periode_id')).length;
    await page.click('button:has-text("Periode ditutup")');
    await page.waitForSelector('text=Pilih periode yang sudah ditutup untuk melihat pengajuannya.');
    assert(srv.log.urls.filter(u => u.includes('action=getPengajuan') && u.includes('periode_id')).length === n, 'tidak boleh memuat sebelum periode dipilih');
    await page.selectOption('main select:visible', 'P1');
    await page.waitForSelector('text=BA-LAMA-PJ');
    main = await page.innerText('main');
    assert(/\(ditutup\)/.test(main) && !main.includes('BA-PA/S2/2026/10/009'), 'periode ditutup: hanya periode itu');
  });
  all &= await run('Pengajuan akuntan: pengingat pengajuan tertunda di hari lain; periode ditutup tanpa tombol ubah', { role: 'akuntan', existing: true, tanggal: '2026-10-15' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    await page.waitForSelector('text=dari hari lain di periode aktif masih menunggu keputusan');
    await page.click('button:has-text("Lihat di Periode aktif")');
    await page.waitForSelector('text=BA-PA/S1/2026/10/001');
    assert(await page.isVisible('main button:text-is("Edit")'), 'periode aktif: tombol Edit ada');
    await page.click('button:has-text("Periode ditutup")');
    await page.selectOption('main select:visible', 'P1');
    await page.waitForSelector('text=BA-LAMA-PJ');
    assert(!(await page.isVisible('main button:text-is("Edit")')) && !(await page.isVisible('main button:text-is("Batalkan")')), 'periode ditutup harus hanya-baca');
  });
  all &= await run('Persetujuan PIC: tab Menunggu (dengan jumlah), Hari ini, Periode aktif, Periode ditutup hanya-baca', { role: 'pic', existing: true, tanggal: '2026-10-15' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Persetujuan');
    await page.waitForSelector('text=Kirim keputusan');
    assert(/Menunggu\s*1/.test(await page.innerText('main')), 'tab Menunggu harus menampilkan jumlah 1');
    await page.click('button:has-text("Hari ini")');
    await page.waitForSelector('text=Belum ada pengajuan dengan hari H');
    await page.click('button:has-text("Periode aktif")');
    await page.waitForSelector('text=Kirim keputusan');
    await page.click('button:has-text("Periode ditutup")');
    await page.selectOption('main select:visible', 'P1');
    await page.waitForSelector('text=BA-LAMA-PJ');
    assert(!(await page.isVisible('text=Kirim keputusan')), 'periode ditutup: tidak bisa memutuskan');
  });

  for (const c of [
    { role: 'admin', ov: null, harap: '(Budi Akuntan)', larang: '(Siti)', ket: 'admin mencetak → nama akuntan dapur, bukan admin' },
    { role: 'yayasan', ov: null, harap: '(Budi Akuntan)', larang: '(Siti)', ket: 'yayasan mencetak → nama akuntan dapur' },
    { role: 'admin', ov: 'lama', harap: '(.................................)', larang: '(Siti)', ket: 'backend lama + admin → dikosongkan untuk tanda tangan basah' },
    { role: 'akuntan', ov: 'lama', harap: '(Siti)', larang: null, ket: 'backend lama + akuntan dapur itu → namanya sendiri' },
  ]) {
    all &= await run('Laporan: ' + c.ket, { role: c.role, laporan: true,
      override: c.ov ? (a) => a === 'getPenandatangan' ? { ok: false, error: 'Unknown action: getPenandatangan' } : null : null }, async (page, srv) => {
      await login(page, 'siti');
      await page.waitForSelector('header');
      await page.click('nav:visible >> text=Laporan');
      await page.waitForSelector('text=Dibuat oleh,');
      await page.waitForFunction(h => document.body.innerText.includes(h), c.harap);
      const body = await page.innerText('main');
      assert(!c.larang || !body.includes(c.larang), 'tidak boleh memuat ' + c.larang);
    });
  }

  all &= await run('Riwayat: saldo tetap benar saat difilter (layar & Excel)', { role: 'akuntan', riwayat: true }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Riwayat');
    await page.waitForSelector('text=Beras 20 kg');
    // tanpa filter: 7.000.000 + 1.000.000 (top-up) − 100.000 − 200.000
    assert((await page.innerText('main')).includes('Rp 7.700.000'), 'saldo akhir tanpa filter harus Rp 7.700.000');
    await page.selectOption('main select:visible >> nth=1', 'Bahan Baku');
    await page.waitForFunction(() => !document.querySelector('main').innerText.includes('Gas 12 kg'));
    const main = await page.innerText('main');
    assert(!main.includes('Gas 12 kg'), 'baris Operasional harus tersembunyi');
    assert(main.includes('Rp 7.700.000') && !main.includes('Rp 7.800.000'), 'saldo baris Bahan Baku harus 7.700.000 (bukan 7.800.000 seperti sebelumnya)');
    assert(main.includes('Filter aktif') && /1 dari 2 transaksi/.test(main) && main.includes('Rp 200.000'), 'keterangan filter + total kredit tersaring');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('main button:has-text("Excel")')]);
    const f = path.join(require('os').tmpdir(), 'mbg-riwayat-uji.xlsx'); await dl.saveAs(f);
    const XLSX = require(path.join(NM, 'xlsx'));
    const rows = XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets['Buku Besar']);
    const bb = rows.find(r => r.Uraian === 'Beras 20 kg');
    assert(rows.length === 2 && bb && bb.Saldo === 7700000, 'Excel: harus 2 baris (saldo awal + Bahan Baku) dengan saldo 7.700.000, dapat: ' + JSON.stringify(rows));
    assert(/tersaring/.test(dl.suggestedFilename()), 'nama file menandai data tersaring: ' + dl.suggestedFilename());
  });

  all &= await run('Riwayat: ganti dapur (admin) → periode ikut pindah ke periode aktif dapur baru', { role: 'admin', riwayat: true }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Riwayat');
    await page.waitForSelector('text=Beras 20 kg');
    await page.selectOption('header select', 'D2');
    await page.waitForFunction(() => [...document.querySelectorAll('main select')].some(x => x.value === 'P9'), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    const u = srv.log.urls.filter(x => x.includes('action=getTransaksi')).pop();
    assert(/periode_id=P9/.test(u), 'transaksi harus diminta untuk periode dapur baru (P9): ' + u);
  });
  all &= await run('Edit transaksi: ganti jenis → kategori lama dikosongkan, tidak bisa simpan sebelum dipilih ulang', { role: 'akuntan', riwayat: true }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Riwayat');
    await page.waitForSelector('text=Beras 20 kg');
    await page.click('main button[title="Edit"] >> nth=1');
    await page.waitForSelector('.sheet >> text=Jenis Transaksi');
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const sh = document.querySelector('.sheet'); const ov = sh.parentElement.getBoundingClientRect(); const sr = sh.getBoundingClientRect(); return { ovTop: Math.round(ov.top), ovH: Math.round(ov.height), vh: innerHeight, sheetTop: Math.round(sr.top) }; });
    assert(g.ovTop === 0 && g.ovH === g.vh && g.sheetTop >= 0, 'overlay modal harus menutupi seluruh layar dan atas modal terlihat: ' + JSON.stringify(g));
    await page.click('.sheet button:text-is("Operasional")');
    await page.waitForTimeout(300);
    const katSel = page.locator('.sheet select').first();
    assert((await katSel.inputValue()) === '', 'kategori harus dikosongkan setelah ganti jenis, dapat: ' + (await katSel.inputValue()));
    assert(await page.isDisabled('.sheet button:has-text("Simpan Perubahan")'), 'tombol simpan harus nonaktif');
    assert(await page.isVisible('.sheet >> text=Kategori wajib dipilih (sesuai jenis Operasional)'), 'pesan kategori harus tampil');
    await katSel.selectOption('Gas');
    assert(!(await page.isDisabled('.sheet button:has-text("Simpan Perubahan")')), 'setelah memilih kategori yang cocok, bisa disimpan');
  });

  all &= await run('Modal konfirmasi kirim pengajuan tampil di tengah LAYAR, bukan di kotak halaman (halaman panjang, sudah digulir)', { role: 'akuntan', existing: true, tanggal: '2026-10-15' }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.click('nav:visible >> text=Pengajuan');
    await page.click('button:has-text("Buat pengajuan")');
    for (let i = 0; i < 4; i++) await page.click('text=Tambah baris');
    await page.selectOption('.rounded-lg select >> nth=0', 'Bahan Baku');
    for (let i = 0; i < 4; i++) await page.click('text=Hapus baris >> nth=-1');
    await page.fill('input[placeholder="cth. Beras 50 kg"]', 'Gula');
    await page.fill('input[inputmode=numeric]', '1000');
    await page.selectOption('select >> nth=-1', 'pn1');
    await page.evaluate(() => window.scrollTo(0, 99999));
    await page.click('text=Kirim untuk persetujuan');
    await page.waitForSelector('.sheet >> text=Kirim pengajuan?');
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => { const sh = [...document.querySelectorAll('.sheet')].pop(); const ov = sh.parentElement.getBoundingClientRect(); const sr = sh.getBoundingClientRect(); return { ovTop: Math.round(ov.top), ovH: Math.round(ov.height), vh: innerHeight, top: Math.round(sr.top), bottom: Math.round(sr.bottom) }; });
    assert(g.ovTop === 0 && g.ovH === g.vh && g.top >= 0 && g.bottom <= g.vh, 'modal konfirmasi harus utuh di dalam layar: ' + JSON.stringify(g));
  });

  all &= await run('Dashboard: grafik harian dimuat belakangan (Recharts tidak menghambat pembukaan)', { role: 'akuntan', grafik: true }, async (page, srv) => {
    await login(page, 'siti');
    await page.waitForSelector('header');
    await page.waitForSelector('text=Realisasi Aktual Harian');
    await page.waitForSelector('.recharts-surface', { timeout: 15000 });
    assert(srv.log.lazy.some(u => /recharts/.test(u)), 'Recharts harus diminta saat Dashboard butuh grafik');
  });

  console.log(all ? 'SEMUA LULUS' : 'ADA YANG GAGAL');
  process.exit(all ? 0 : 1);
})();
