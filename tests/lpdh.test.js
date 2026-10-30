// Uji pengisian template LPDH (fungsi isiLPDH di src/index.html) dengan template asli PPK.
// Jalankan: npm run test:lpdh   (opsional: LibreOffice `soffice` untuk memeriksa hasil rumus)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const blok = src.slice(src.indexOf('// <LPDH-ISI>'), src.indexOf('// </LPDH-ISI>'));
const L = new Function(blok + '\nreturn { isiLPDH, lpdhInfoHari, lpdhNomorDefault, lpdhBarisOps, lpdhGabung, LPDH_KAP };')();
const TPL = path.join(ROOT, 'templates', 'LPDH_SPPG.xlsx');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const tx = (i, jenis, kategori, riil, extra) => Object.assign({ id: 'T' + i, tanggal: '2026-10-28', no_bukti: 'NB-' + i, jenis, kategori, uraian: 'Uraian ' + i,
  sumber: 'VA', riil, bukti_url: 'https://drive.google.com/file/d/' + i, pemasok: 'Toko ' + i }, extra || {});
const KAT_OPS = ['Gas', 'Sewa Kendaraan', 'Listrik', 'Biaya Admin Bank', 'Sampah', 'Pulsa', 'Internet/Telepon'];
function dataUji(nOp) {
  const t = [tx(1, 'Bahan Baku', 'Semua Kategori', 600000), tx(2, 'Bahan Baku', 'Semua Kategori', 400000),
    tx(3, 'Operasional', 'Gaji/honor relawan pekerja SPPG', 90000, { sumber: 'Petty Cash' }),
    tx(4, 'Fasilitas SPPG', 'Sewa Gedung', 300000), tx(5, 'Fasilitas SPPG', 'Sewa Gedung', 200000)];
  for (let i = 0; i < nOp; i++) t.push(tx(10 + i, 'Operasional', KAT_OPS[i % KAT_OPS.length], 10000));
  return { dapur: { id: 'D004', nama: 'SPPG Cipaku 02', kode: 'CPK02' }, tanggal: '2026-10-28', saldoAwal: 10000000,
    identitas: { id_sppg: '32.04.01.0001', desa: 'Cipaku', kecamatan: 'Paseh', kabupaten: 'Kabupaten Bandung', provinsi: 'Jawa Barat', yayasan: 'Koperasi ISS',
      no_va: '0012345678901234', bank: 'BRI', pengawas_nama: 'Peng', pengawas_nik: '3204000000000001', kepala_nama: 'Kep', kepala_nip: '199001012026011001', wakil_nama: 'Wak', wakil_nik: '3204000000000002' },
    transaksi: t, komponen: { awal: [6000000, 3000000, 1000000], topups: [{ tanggal: '2026-10-28', jumlah: 1000000, keterangan: 'TU-1', bagi: [700000, 200000, 100000] }],
      geser: [{ dari: 1, ke: 0, jumlah: 50000 }], nama: ['Bahan Baku', 'Operasional', 'Insentif'] } };
}

(async () => {
  // fungsi bantu
  ok(L.lpdhBarisOps('Biaya Admin Bank')[0] === 21 && L.lpdhBarisOps('Sewa Kendaraan')[0] === 14 && L.lpdhBarisOps('Internet/Telepon')[0] === 16, 'pemetaan kategori: admin bank → Lain-lain, sewa → 14, internet → 16');
  const pj = L.lpdhGabung(Array.from({ length: 60 }, (_, i) => 'NOMOR-BUKTI-' + i), '; ');
  ok(pj.length <= 250 && /lainnya\)$/.test(pj), 'gabungan nomor bukti dibatasi ≤ 250 karakter (batas rumus COUNTIF)');
  const h = L.lpdhInfoHari('2026-10-28');
  ok(h.hpeKe === 3 && !h.akhirPekan && h.mingguKe === 5, 'Rabu 28 Okt 2026: HPE ke-3, minggu ke-5 (' + JSON.stringify(h) + ')');
  ok(L.lpdhInfoHari('2026-10-31').akhirPekan && L.lpdhInfoHari('2026-10-31').hpeKe === '', 'Sabtu: bukan HPE otomatis');
  ok(L.lpdhNomorDefault('2026-10-28', 'CPK02') === '028/LPDH/CPK02/X/2026', 'nomor LPDH bawaan');

  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(TPL);
  const d = dataUji(35);
  const r = L.isiLPDH(wb, d, {});
  const v = (s, a) => { const x = wb.getWorksheet(s).getCell(a).value; return x && x.formula ? '=' : x; };
  ok(v('Identitas', 'B7') === 'SPPG Cipaku 02' && v('Identitas', 'B6') === '32.04.01.0001' && v('Identitas', 'D36') === '3204000000000001', 'identitas & NIK terisi (NIK sebagai teks)');
  ok(v('Identitas', 'B18') === 'HPE' && v('Identitas', 'B19') === 3, 'status hari & HPE ke- terisi');
  ok(v('Identitas', 'F36') === null && v('Identitas', 'B25') === null, 'tanda tangan & waktu unggah dikosongkan (diisi manual)');
  ok(v('A_PM', 'E6') === null && v('A_PM', 'C19') === null && v('A_PM', 'M6') === null, 'data contoh A_PM dibersihkan');
  ok(v('Ref', 'A64') === null, 'contoh indeks kemahalan di Ref dibersihkan');
  ok(v('B_BahanBaku', 'D6') === 'Uraian 1' && v('B_BahanBaku', 'H7') === 400000 && v('B_BahanBaku', 'J6') === 'Toko 1' && v('B_BahanBaku', 'D8') === null, 'bahan baku: 2 baris, sisa contoh terhapus');
  ok(v('B_BahanBaku', 'I6') === '=' && v('B_BahanBaku', 'B6') === '=', 'rumus template tetap ada');
  ok(v('C_Operasional', 'D14') === 'Sewa kendaraan' && v('C_Operasional', 'D21') === 'Lain-lain' && v('C_Operasional', 'D7') === 'Insentif penanggung jawab satuan pendidikan', 'label kategori template (kolom D) tidak ditimpa');
  ok(v('C_Operasional', 'G13') === 50000 && v('C_Operasional', 'F13') === '5 transaksi' && v('C_Operasional', 'E13') === 1, '35 transaksi operasional digabung per kategori: Gas 5 transaksi = Rp 50.000');
  ok(v('C_Operasional', 'G21') === 100000 && String(v('C_Operasional', 'M21')).includes('Biaya Admin Bank: '), 'biaya admin & sampah masuk Lain-lain, kategorinya disebut di keterangan');
  ok(v('C_Operasional', 'G16') === 100000, 'pulsa + internet digabung di baris Pulsa dan internet');
  ok(v('C_Operasional', 'G7') === null && v('C_Operasional', 'C7') === null, 'kategori tanpa transaksi dibiarkan kosong (contoh dibersihkan)');
  ok(String(v('C_Operasional', 'I13')).split('; ').length === 5 && String(v('C_Operasional', 'J13')).startsWith('https://'), 'nomor bukti & link transaksi yang digabung tercantum');
  ok(r.kelebihan.length === 0, 'tidak ada transaksi operasional yang terbuang');
  ok(v('C_Operasional', 'E6') === '=', 'baris 6 (honor relawan dari C1) tetap rumus');
  ok(v('C1_Relawan', 'G6') === 90000 && v('C1_Relawan', 'I6') === 'Tunai', 'honor relawan masuk C1 (kas kecil = Tunai)');
  ok(v('D_Insentif', 'C21') === 500000 && v('D_Insentif', 'C23') === 'NB-4; NB-5' && v('D_Insentif', 'B6') === null, 'dua pembayaran insentif Yayasan hari itu dijumlah; syarat dikosongkan');
  ok(v('E_Saldo', 'B5') === 6000000 && v('E_Saldo', 'B6') === 3000000 && v('E_Saldo', 'B7') === 1000000, 'saldo awal komponen dari server');
  ok(v('E_Saldo', 'E19') === 700000 && v('E_Saldo', 'F19') === 200000 && v('E_Saldo', 'G19') === 100000 && v('E_Saldo', 'D19') === 'TU-1', 'top up per komponen dari server');
  ok(/pergeseran Rp 50\.000 dari Operasional/.test(v('E_Saldo', 'F5')) && /ke Bahan Baku/.test(v('E_Saldo', 'F6')) && /PPK/.test(v('E_Saldo', 'F5')), 'pergeseran antar komponen dicatat di keterangan saldo');
  ok(v('E_Saldo', 'E10') === null, 'saldo VA mutasi rekening dikosongkan (diisi manual)');
  let sisa = 0;
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => { const x = c.value; if (x && typeof x === 'object' && (x.formula || x.sharedFormula) && 'result' in x) sisa++; })));
  ok(sisa === 0, 'tidak ada hasil rumus lama (angka contoh) yang terbawa: ' + sisa);
  ok(r.namaFile === '32.04.01.0001_SPPG Cipaku 02_LPDH_20261028.xlsx', 'nama file sesuai aturan PPK');

  // tulis & baca ulang: struktur template utuh
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdh-'));
  const out = path.join(tmp, 'out.xlsx');
  await wb.xlsx.writeFile(out);
  const asli = new ExcelJS.Workbook(); await asli.xlsx.readFile(TPL);
  const hit = w => { let f = 0, m = 0; w.eachSheet(ws => { m += Object.keys(ws._merges || {}).length; ws.eachRow(row => row.eachCell(c => { if (c.formula || c.sharedFormula) f++; })); }); return { f, m, s: w.worksheets.map(x => x.name).join(',') }; };
  const w2 = new ExcelJS.Workbook(); await w2.xlsx.readFile(out);
  const a = hit(asli), c = hit(w2);
  ok(a.f === c.f && a.m === c.m && a.s === c.s, 'jumlah rumus, sel gabungan, dan urutan sheet sama dengan template (' + JSON.stringify(c) + ')');

  // hasil rumus (bila LibreOffice ada)
  let soffice = null; try { soffice = cp.execSync('command -v soffice', { encoding: 'utf8' }).trim(); } catch (e) {}
  if (!soffice) console.log('LEWAT  pemeriksaan rumus (soffice tidak ada)');
  else {
    cp.execSync('"' + soffice + '" --headless --calc --convert-to xlsx --outdir "' + path.join(tmp, 'calc') + '" "' + out + '"', { stdio: 'ignore', timeout: 120000 });
    const cw = XLSX.readFile(path.join(tmp, 'calc', 'out.xlsx'));
    const g = (s, a) => { const x = cw.Sheets[s][a]; return x ? x.v : ''; };
    ok(g('Identitas', 'B16') === 'Rabu' && g('Identitas', 'B20') === 'Ya', 'rumus hari & HPE terhitung');
    ok(g('B_BahanBaku', 'I46') === 1000000 && g('B_BahanBaku', 'N6') === 'Sesuai' && g('B_BahanBaku', 'M6') === 'Unik', 'total bahan baku & status bukti terhitung');
    ok(g('C_Operasional', 'H6') === 90000 && g('C_Operasional', 'H22') === 90000 + 350000, 'operasional = honor relawan (C1) + semua 35 transaksi');
    ok(g('C_Operasional', 'K13') === 'Unik' && g('C_Operasional', 'L13') === 'Sesuai', 'baris gabungan lolos cek nomor & tanggal');
    ok(g('E_Saldo', 'E5') >= 0 && g('E_Saldo', 'E6') >= 0 && g('E_Saldo', 'E7') >= 0, 'saldo akhir tiap komponen tidak negatif');
    ok(g('E_Saldo', 'E8') === 10000000 + 1000000 - (1000000 + 440000 + 500000), 'saldo akhir total = awal + top up − pengeluaran');
    ok(g('Identitas', 'E36') === 'Valid' && g('Identitas', 'E37') === 'Valid', 'NIK/NIP lolos validasi rumus');
    ok(g('I_RegisterBukti', 'C127') === 0 && g('I_RegisterBukti', 'C129') === 1, 'register: tidak ada duplikat; satu-satunya tanpa link = bukti terima top up (diisi manual)');
    ok(String(g('J_Pengesahan', 'D5')).includes('SPPG Cipaku 02') && g('J_Pengesahan', 'B33') === 'Peng', 'lembar pengesahan terisi');
  }
  console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
