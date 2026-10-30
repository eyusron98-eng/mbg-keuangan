// Uji pengisian template LPDH (fungsi isiLPDH di src/index.html) dengan template asli PPK.
// Jalankan: npm run test:lpdh   (opsional: LibreOffice `soffice` untuk memeriksa hasil rumus)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const blok = src.slice(src.indexOf('// <LPDH-ISI>'), src.indexOf('// </LPDH-ISI>'));
const L = new Function(blok + '\nreturn { isiLPDH, lpdhPisah, lpdhInfoHari, lpdhNomorDefault, LPDH_KAP };')();
const TPL = path.join(ROOT, 'templates', 'LPDH_SPPG.xlsx');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const tx = (i, jenis, kategori, riil, extra) => Object.assign({ id: 'T' + i, tanggal: '2026-10-28', no_bukti: 'NB-' + i, jenis, kategori, uraian: 'Uraian ' + i,
  sumber: 'VA', riil, bukti_url: 'https://drive.google.com/file/d/' + i, pemasok: 'Toko ' + i }, extra || {});
function dataUji(nOp) {
  const t = [tx(1, 'Bahan Baku', 'Semua Kategori', 600000), tx(2, 'Bahan Baku', 'Semua Kategori', 400000),
    tx(3, 'Operasional', 'Gaji/honor relawan pekerja SPPG', 90000, { sumber: 'Petty Cash' }), tx(4, 'Fasilitas SPPG', 'Fasilitas SPPG', 300000)];
  for (let i = 0; i < nOp; i++) t.push(tx(10 + i, 'Operasional', 'Gas', 10000));
  return { dapur: { id: 'D004', nama: 'SPPG Cipaku 02', kode: 'CPK02' }, tanggal: '2026-10-28', saldoAwal: 10000000,
    identitas: { id_sppg: '32.04.01.0001', desa: 'Cipaku', kecamatan: 'Paseh', kabupaten: 'Kabupaten Bandung', provinsi: 'Jawa Barat', yayasan: 'Koperasi ISS',
      no_va: '0012345678901234', bank: 'BRI', pengawas_nama: 'Peng', pengawas_nik: '3204000000000001', kepala_nama: 'Kep', kepala_nip: '199001012026011001', wakil_nama: 'Wak', wakil_nik: '3204000000000002' },
    transaksi: t, topups: [{ tanggal: '2026-10-28', jumlah: 1000000, keterangan: 'TU-1' }] };
}

(async () => {
  // fungsi bantu
  ok(JSON.stringify(L.lpdhPisah(100, [1, 1, 1])) === '[34,33,33]' || L.lpdhPisah(100, [1, 1, 1]).reduce((a, b) => a + b) === 100, 'pembagian rupiah selalu berjumlah sama dengan total');
  ok(JSON.stringify(L.lpdhPisah(500, [0, 0, 0])) === '[500,0,0]', 'tanpa pengeluaran → saldo dicatat di Bahan Baku');
  const h = L.lpdhInfoHari('2026-10-28');
  ok(h.hpeKe === 3 && !h.akhirPekan && h.mingguKe === 5, 'Rabu 28 Okt 2026: HPE ke-3, minggu ke-5 (' + JSON.stringify(h) + ')');
  ok(L.lpdhInfoHari('2026-10-31').akhirPekan && L.lpdhInfoHari('2026-10-31').hpeKe === '', 'Sabtu: bukan HPE otomatis');
  ok(L.lpdhNomorDefault('2026-10-28', 'CPK02') === '028/LPDH/CPK02/X/2026', 'nomor LPDH bawaan');

  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(TPL);
  const d = dataUji(17);
  const r = L.isiLPDH(wb, d, {});
  const v = (s, a) => { const x = wb.getWorksheet(s).getCell(a).value; return x && x.formula ? '=' : x; };
  ok(v('Identitas', 'B7') === 'SPPG Cipaku 02' && v('Identitas', 'B6') === '32.04.01.0001' && v('Identitas', 'D36') === '3204000000000001', 'identitas & NIK terisi (NIK sebagai teks)');
  ok(v('Identitas', 'B18') === 'HPE' && v('Identitas', 'B19') === 3, 'status hari & HPE ke- terisi');
  ok(v('Identitas', 'F36') === null && v('Identitas', 'B25') === null, 'tanda tangan & waktu unggah dikosongkan (diisi manual)');
  ok(v('A_PM', 'E6') === null && v('A_PM', 'C19') === null && v('A_PM', 'M6') === null, 'data contoh A_PM dibersihkan');
  ok(v('Ref', 'A64') === null, 'contoh indeks kemahalan di Ref dibersihkan');
  ok(v('B_BahanBaku', 'D6') === 'Uraian 1' && v('B_BahanBaku', 'H7') === 400000 && v('B_BahanBaku', 'J6') === 'Toko 1' && v('B_BahanBaku', 'D8') === null, 'bahan baku: 2 baris, sisa contoh terhapus');
  ok(v('B_BahanBaku', 'I6') === '=' && v('B_BahanBaku', 'B6') === '=', 'rumus template tetap ada');
  ok(v('C_Operasional', 'D7') === 'Uraian 10' && v('C_Operasional', 'D21') === 'Uraian 24' && v('C_Operasional', 'E6') === '=', 'operasional penuh 15 baris; baris 6 (relawan) tetap rumus');
  ok(r.kelebihan.length === 2 && r.kelebihan.every(k => k.bagian === 'op'), '17 transaksi operasional → 2 dilaporkan tidak muat');
  ok(v('C1_Relawan', 'G6') === 90000 && v('C1_Relawan', 'I6') === 'Tunai', 'honor relawan masuk C1 (kas kecil = Tunai)');
  ok(v('D_Insentif', 'C21') === 300000 && v('D_Insentif', 'B6') === null, 'insentif Yayasan terisi; syarat dikosongkan untuk diisi');
  const b = [v('E_Saldo', 'B5'), v('E_Saldo', 'B6'), v('E_Saldo', 'B7')];
  ok(b[0] + b[1] + b[2] === 10000000, 'saldo awal 3 komponen berjumlah sama dengan saldo awal');
  ok(v('E_Saldo', 'E19') + v('E_Saldo', 'F19') + v('E_Saldo', 'G19') === 1000000 && v('E_Saldo', 'D19') === 'TU-1', 'top up dibagi 3 komponen, jumlah tetap');
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
    ok(g('C_Operasional', 'H6') === 90000 && g('C_Operasional', 'H22') === 90000 + 150000, 'operasional = honor relawan (C1) + 15 baris');
    ok(g('E_Saldo', 'E5') >= 0 && g('E_Saldo', 'E6') >= 0 && g('E_Saldo', 'E7') >= 0, 'saldo akhir tiap komponen tidak negatif');
    ok(g('E_Saldo', 'E8') === 10000000 + 1000000 - (1000000 + 240000 + 300000), 'saldo akhir total = awal + top up − pengeluaran yang tercantum');
    ok(g('Identitas', 'E36') === 'Valid' && g('Identitas', 'E37') === 'Valid', 'NIK/NIP lolos validasi rumus');
    ok(g('I_RegisterBukti', 'C127') === 0 && g('I_RegisterBukti', 'C129') === 1, 'register: tidak ada duplikat; satu-satunya tanpa link = bukti terima top up (diisi manual)');
    ok(String(g('J_Pengesahan', 'D5')).includes('SPPG Cipaku 02') && g('J_Pengesahan', 'B33') === 'Peng', 'lembar pengesahan terisi');
  }
  console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
