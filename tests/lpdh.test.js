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
  const t = [tx(1, 'Bahan Baku', 'Semua Kategori', 600000),
    tx(2, 'Bahan Baku', 'Semua Kategori', 400000, { nota_url: 'https://drive.google.com/nota2',
      rincian: [{ nama: 'Wortel', kategori: 'Sayuran', volume: 10, satuan: 'kg', harga: 15000 }, { nama: 'Kol', kategori: 'Sayuran', volume: 12.5, satuan: 'kg', harga: 20000 }] }),
    tx(3, 'Operasional', 'Gaji/honor relawan pekerja SPPG', 90000, { sumber: 'Petty Cash',
      relawan: [{ nama: 'Ani', tugas: 'Juru masak', hari: 1, upah: 50000, metode: 'Tunai' }, { nama: 'Budi', tugas: 'Pengemudi', hari: 1, upah: 40000, metode: 'Transfer' }] }),
    tx(4, 'Fasilitas SPPG', 'Sewa Gedung', 300000, { insentif: { no_ppk: 'PPK/1', nilai_ppk: 300000, no_kuitansi: 'KW-1', kuitansi_ttd: 'Ya', ref_va: 'TRX-1' } }),
    tx(5, 'Fasilitas SPPG', 'Sewa Gedung', 200000, { insentif: { no_ppk: 'PPK/2', nilai_ppk: 200000, no_kuitansi: 'KW-2', kuitansi_ttd: 'Ya', ref_va: 'TRX-2' } })];
  for (let i = 0; i < nOp; i++) t.push(tx(10 + i, 'Operasional', KAT_OPS[i % KAT_OPS.length], 10000));
  return { dapur: { id: 'D004', nama: 'SPPG Cipaku 02', kode: 'CPK02' }, tanggal: '2026-10-28', saldoAwal: 10000000,
    identitas: { id_sppg: '32.04.01.0001', desa: 'Cipaku', kecamatan: 'Paseh', kabupaten: 'Kabupaten Bandung', provinsi: 'Jawa Barat', yayasan: 'Koperasi ISS',
      no_va: '0012345678901234', bank: 'BRI', pengawas_nama: 'Peng', pengawas_nik: '3204000000000001', kepala_nama: 'Kep', kepala_nip: '199001012026011001', wakil_nama: 'Wak', wakil_nik: '3204000000000002' },
    harian: { pm: [{ kode: 'KS-02', target: 650, distribusi: 650, diterima: 640, tidak: 10, alasan: 'PM tidak hadir', bnba: 'Ya', bast: 'BAST-02', link: 'https://cloud/bast2' },
        { kode: 'PTK', target: 40, distribusi: 40, diterima: 40, tidak: 0, alasan: '', bnba: 'Ya', bast: 'BAST-PTK', link: 'https://cloud/bastptk' }],
      produksi: { total: 696, organoleptik: 3, sampel: 3, tidak_terdistribusi: 0, buffer: 0 },
      syarat: { kontaminasi: 'Tidak', fatal: 'Tidak', suspend: 'Tidak', verifikasi: 'Ya', sipgn: 'Ya' } },
    saldoRekening: { saldo_va: 9060000, penjelasan: '' },
    transaksi: t, komponen: { awal: [6000000, 3000000, 1000000], topups: [{ tanggal: '2026-10-28', jumlah: 1000000, keterangan: 'TU-1', bagi: [700000, 200000, 100000],
      no_sp2d: 'SP2D-9', no_kuitansi: 'KW-TU-9', bukti_url: 'https://cloud/tu9' }],
      geser: [{ dari: 1, ke: 0, jumlah: 50000 }], nama: ['Bahan Baku', 'Operasional', 'Insentif'] } };
}

(async () => {
  // fungsi bantu
  ok(L.lpdhBarisOps('Biaya Admin Bank')[0] === 21 && L.lpdhBarisOps('Sewa Kendaraan')[0] === 14 && L.lpdhBarisOps('Internet/Telepon')[0] === 16, 'pemetaan kategori: admin bank → Lain-lain, sewa → 14, internet → 16');
  ok(L.lpdhBarisOps('Barang Habis Pakai', 'Pembelian BHP (Sunlight 610ml) tgl 24')[1] === 'Alat kebersihan'
    && L.lpdhBarisOps('Barang Habis Pakai', 'Trash Bag 5 pack')[1] === 'Alat kebersihan'
    && L.lpdhBarisOps('Barang Habis Pakai', 'beli masker & sarung tangan, sabun')[1].startsWith('APD')
    && L.lpdhBarisOps('Barang Habis Pakai', 'kertas HVS & spidol')[1] === 'ATK'
    && L.lpdhBarisOps('Barang Habis Pakai', 'Plastik 1/2 17 pack')[1] === 'Lain-lain'
    && L.lpdhBarisOps('Barang Habis Pakai', 'Pembelian BHP tgl 6 Okt')[1] === 'Lain-lain'
    && L.lpdhBarisOps('Air Bersih (Sumur)', '')[1] === 'Air PDAM' && L.lpdhBarisOps('Konsumsi Tamu', 'rapat')[1] === 'Lain-lain',
    'Barang Habis Pakai dipilah dari uraian (APD/kebersihan/ATK, sisanya Lain-lain); Air Sumur → Air PDAM; rapat → Lain-lain');
  const pj = L.lpdhGabung(Array.from({ length: 60 }, (_, i) => 'NOMOR-BUKTI-' + i), '; ');
  ok(pj.length <= 250 && /lainnya\)$/.test(pj), 'gabungan nomor bukti dibatasi ≤ 250 karakter (batas rumus COUNTIF)');
  const h = L.lpdhInfoHari('2026-10-28');
  ok(h.hpeKe === 3 && !h.akhirPekan && h.mingguKe === 5, 'Rabu 28 Okt 2026: HPE ke-3, minggu ke-5 (' + JSON.stringify(h) + ')');
  ok(L.lpdhInfoHari('2026-10-31').akhirPekan && L.lpdhInfoHari('2026-10-31').hpeKe === '', 'Sabtu: bukan HPE otomatis');
  ok(L.lpdhNomorDefault('2026-10-28', 'CPK02') === '028/LPDH/CPK02/X/2026', 'nomor LPDH bawaan');

  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(TPL);
  const d = dataUji(35);
  const r = L.isiLPDH(wb, d, { waktu: new Date(2026, 9, 29, 5, 30) });
  const v = (s, a) => { const x = wb.getWorksheet(s).getCell(a).value; return x && x.formula ? '=' : x; };
  ok(v('Identitas', 'B7') === 'SPPG Cipaku 02' && v('Identitas', 'B6') === '32.04.01.0001' && v('Identitas', 'D36') === '3204000000000001', 'identitas & NIK terisi (NIK sebagai teks)');
  ok(v('Identitas', 'B18') === 'HPE' && v('Identitas', 'B19') === 3, 'status hari & HPE ke- terisi');
  ok(v('Identitas', 'F36') === null, 'kolom "sudah tanda tangan" dikosongkan (diisi setelah ttd)');
  ok(v('Identitas', 'B25') instanceof Date && v('Identitas', 'B25').toISOString().slice(0, 10) === '2026-10-29' && Math.abs(v('Identitas', 'B26') - 330 / 1440) < 1e-9, 'tanggal & jam unggah = waktu LPDH dibuat');
  ok(v('A_PM', 'E6') === null && v('A_PM', 'M6') === null && v('A_PM', 'E10') === null, 'data contoh A_PM dibersihkan');
  ok(v('Ref', 'A64') === null, 'contoh indeks kemahalan di Ref dibersihkan');
  ok(v('B_BahanBaku', 'D6') === 'Uraian 1' && v('B_BahanBaku', 'G6') === 'nota' && v('B_BahanBaku', 'J6') === 'Toko 1', 'nota tanpa rincian (data lama): 1 baris per nota');
  ok(v('B_BahanBaku', 'D7') === 'Wortel' && v('B_BahanBaku', 'E7') === 'Sayuran' && v('B_BahanBaku', 'F8') === 12.5 && v('B_BahanBaku', 'G8') === 'kg' && v('B_BahanBaku', 'H8') === 20000,
    'nota berrincian: 1 baris per bahan (nama, kategori, volume, satuan, harga)');
  ok(v('B_BahanBaku', 'K7') === 'NB-2/1' && v('B_BahanBaku', 'K8') === 'NB-2/2' && v('B_BahanBaku', 'L7') === 'https://drive.google.com/nota2', 'nomor bukti bersufiks /1 /2 & link ke foto nota');
  ok(v('B_BahanBaku', 'D9') === null, 'sisa baris contoh terhapus');
  ok(v('B_BahanBaku', 'I6') === '=' && v('B_BahanBaku', 'B6') === '=', 'rumus template tetap ada');
  ok(v('C_Operasional', 'D14') === 'Sewa kendaraan' && v('C_Operasional', 'D21') === 'Lain-lain' && v('C_Operasional', 'D7') === 'Insentif penanggung jawab satuan pendidikan', 'label kategori template (kolom D) tidak ditimpa');
  ok(v('C_Operasional', 'G13') === 50000 && v('C_Operasional', 'F13') === '5 transaksi' && v('C_Operasional', 'E13') === 1, '35 transaksi operasional digabung per kategori: Gas 5 transaksi = Rp 50.000');
  ok(v('C_Operasional', 'G21') === 100000 && String(v('C_Operasional', 'M21')).includes('Biaya Admin Bank: '), 'biaya admin & sampah masuk Lain-lain, kategorinya disebut di keterangan');
  ok(v('C_Operasional', 'G16') === 100000, 'pulsa + internet digabung di baris Pulsa dan internet');
  ok(v('C_Operasional', 'G7') === null && v('C_Operasional', 'C7') === null, 'kategori tanpa transaksi dibiarkan kosong (contoh dibersihkan)');
  ok(String(v('C_Operasional', 'I13')).split('; ').length === 5 && String(v('C_Operasional', 'J13')).startsWith('https://'), 'nomor bukti & link transaksi yang digabung tercantum');
  ok(r.kelebihan.length === 0, 'tidak ada transaksi operasional yang terbuang');
  ok(v('C_Operasional', 'E6') === '=', 'baris 6 (honor relawan dari C1) tetap rumus');
  ok(v('C1_Relawan', 'C6') === 'Ani' && v('C1_Relawan', 'G6') === 50000 && v('C1_Relawan', 'I6') === 'Tunai' && v('C1_Relawan', 'C7') === 'Budi' && v('C1_Relawan', 'J7') === 'NB-3/2',
    'honor relawan: 1 baris per relawan dari daftar, nomor bukti bersufiks');
  ok(v('A_PM', 'E7') === 650 && v('A_PM', 'G7') === 640 && v('A_PM', 'I7') === 'PM tidak hadir' && v('A_PM', 'L7') === 'BAST-02' && v('A_PM', 'M15') === 'https://cloud/bastptk', 'A_PM terisi dari data harian PIC');
  ok(v('A_PM', 'C19') === 696 && v('A_PM', 'C21') === 3 && v('A_PM', 'E6') === null, 'produksi POP terisi; kelompok tanpa data kosong');
  ok(v('D_Insentif', 'B6') === 'Tidak' && v('D_Insentif', 'B9') === 'Ya' && v('D_Insentif', 'B10') === 'Ya', 'syarat insentif terisi dari data harian');
  ok(v('D_Insentif', 'C21') === 500000 && v('D_Insentif', 'C23') === 'NB-4; NB-5', 'dua pembayaran insentif Yayasan hari itu dijumlah');
  ok(v('E_Saldo', 'B5') === 6000000 && v('E_Saldo', 'B6') === 3000000 && v('E_Saldo', 'B7') === 1000000, 'saldo awal komponen dari server');
  ok(v('E_Saldo', 'E19') === 700000 && v('E_Saldo', 'F19') === 200000 && v('E_Saldo', 'G19') === 100000, 'top up per komponen dari server');
  ok(/pergeseran Rp 50\.000 dari Operasional/.test(v('E_Saldo', 'F5')) && /ke Bahan Baku/.test(v('E_Saldo', 'F6')) && /PPK/.test(v('E_Saldo', 'F5')), 'pergeseran antar komponen dicatat di keterangan saldo');
  ok(v('E_Saldo', 'E10') === 9060000, 'saldo VA rekening dari isian akuntan');
  ok(v('E_Saldo', 'D19') === 'SP2D-9' && v('E_Saldo', 'I19') === 'KW-TU-9' && v('E_Saldo', 'J19') === 'https://cloud/tu9', 'top up: SP2D, kuitansi, link bukti terima');
  ok(v('D_Insentif', 'C19') === 'PPK/1; PPK/2' && v('D_Insentif', 'C20') === 500000 && v('D_Insentif', 'C24') === 'KW-1; KW-2' && v('D_Insentif', 'C25') === 'Ya' && v('D_Insentif', 'C27') === 'TRX-1; TRX-2', 'insentif: pernyataan PPK, kuitansi, ttd, referensi VA');
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
    ok(g('B_BahanBaku', 'I46') === 1000000 && g('B_BahanBaku', 'N6') === 'Sesuai' && g('B_BahanBaku', 'M7') === 'Unik' && g('B_BahanBaku', 'M8') === 'Unik', 'total bahan baku (rincian = nominal) & nomor bersufiks unik');
    ok(g('C1_Relawan', 'H66') === 90000 && g('C1_Relawan', 'N6') === 'Lengkap' && g('C1_Relawan', 'L7') === 'Unik', 'C1: total relawan = transaksi; bukti per relawan lengkap & unik');
    ok(g('A_PM', 'J7') === 0 && g('A_PM', 'N7') === 'Terlampir' && g('A_PM', 'O7') === 640 && g('A_PM', 'C47') === 640 + 40 + 3 + 3, 'A_PM: distribusi seimbang, BAST terlampir, PM dihitung (' + ['J7', 'N7', 'O7', 'C44', 'C45', 'C46', 'C47'].map(a => a + '=' + g('A_PM', a)).join(' ') + ')');
    ok(g('D_Insentif', 'C11') === 'Ya' && g('D_Insentif', 'C31') === 0 && g('D_Insentif', 'C34') === 'Lengkap', 'syarat insentif terpenuhi; pembayaran = pernyataan PPK; bukti lengkap');
    ok(g('Identitas', 'B28') === 'Ya', 'unggah tepat waktu (05:30 H+1)');
    ok(g('E_Saldo', 'M19') === 'Lengkap' && g('I_RegisterBukti', 'C129') === 0, 'top up berbukti lengkap; tidak ada transaksi tanpa link');
    ok(Math.abs(g('E_Saldo', 'E11')) < 1, 'saldo komponen = saldo VA rekening (' + g('E_Saldo', 'E11') + ')');
    ok(g('C_Operasional', 'H6') === 90000 && g('C_Operasional', 'H22') === 90000 + 350000, 'operasional = honor relawan (C1) + semua 35 transaksi');
    ok(g('C_Operasional', 'K13') === 'Unik' && g('C_Operasional', 'L13') === 'Sesuai', 'baris gabungan lolos cek nomor & tanggal');
    ok(g('E_Saldo', 'E5') >= 0 && g('E_Saldo', 'E6') >= 0 && g('E_Saldo', 'E7') >= 0, 'saldo akhir tiap komponen tidak negatif');
    ok(g('E_Saldo', 'E8') === 10000000 + 1000000 - (1000000 + 440000 + 500000), 'saldo akhir total = awal + top up − pengeluaran');
    ok(g('Identitas', 'E36') === 'Valid' && g('Identitas', 'E37') === 'Valid', 'NIK/NIP lolos validasi rumus');
    ok(g('I_RegisterBukti', 'C127') === 0, 'register: tidak ada nomor duplikat');
    ok(String(g('J_Pengesahan', 'D5')).includes('SPPG Cipaku 02') && g('J_Pengesahan', 'B33') === 'Peng', 'lembar pengesahan terisi');
  }
  console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
