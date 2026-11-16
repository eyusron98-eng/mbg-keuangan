// Uji pembaca mutasi rekening BNI (blok // <MUTASI> di src/index.html). Data sintetis — bukan mutasi asli.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const blok = src.slice(src.indexOf('// <MUTASI>'), src.indexOf('// </MUTASI>'));
const M = new Function(blok + '\nreturn { mutasiBarisHalaman, bacaMutasiBNI, ringkasMutasi, gabungMutasi };')();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const S = '    ';
const baris = (...k) => k.join(S);

// 1) item pdf.js → baris: urut atas-ke-bawah, kiri-ke-kanan; celah lebar = pemisah kolom; teks miring (watermark) dibuang
const items = [
  { str: 'B', x: 60, y: 700, w: 5 }, { str: 'A', x: 10, y: 701, w: 20 }, { str: 'C', x: 66, y: 700, w: 5 },
  { str: 'WATERMARK', x: 30, y: 650, w: 80, miring: true }, { str: 'bawah', x: 10, y: 600, w: 20 }, { str: ' ', x: 40, y: 600, w: 2 },
];
const hb = M.mutasiBarisHalaman(items);
ok(hb.length === 2 && hb[0] === 'A' + S + 'B C' && hb[1] === 'bawah', 'baris halaman: ' + JSON.stringify(hb));

// 2) baris mutasi (laporan BNI: nomor besar = transaksi paling lama), kop/kaki halaman di tengah
const lines = [
  baris('NO', 'TANGGAL', 'NO JURNAL', 'DESKRIPSI', 'TIPE', 'SALDO AWAL', 'DEBET', 'KREDIT', 'SALDO AKHIR', 'CHANNEL'),
  baris('1', '01-Nov-2026 09:00:00', '100003', 'SETORAN DANA BGN', 'K', '1.193.500', '0', '1.000.000', '2.193.500', 'TELLER'),
  baris('2', '27-Okt-2026 10:11:12', '100002', 'PEMINDAHAN KE', 'D', '1.493.500', '300.000', '0', '1.193.500', 'BNIDIRECT'),
  'Halaman 1 dari 2',
  'Sudah Divalidasi oleh sistem',
  '9876543210 BUDI SANTOSO',
  baris('3', '26-Okt-2026 08:00:01', '100001', 'BY TRX ATM PRIMA', 'D', '1.500.000', '6.500', '0', '1.493.500', 'BNIDIRECT'),
  baris('4', '26-Okt-2026 08:00:01', '100001', 'TRANSFER KE | |0001234567890 | TOKO SAYUR', 'D', '2.000.000', '500.000', '0', '1.500.000', 'BNIDIRECT'),
];
const rows = M.bacaMutasiBNI(lines);
ok(rows.length === 4, '4 baris transaksi terbaca (kop & kaki diabaikan)');
ok(rows[0].tgl === '2026-11-01' && rows[0].tipe === 'K' && rows[0].kredit === 1000000, 'dana masuk: tipe K, tanggal Indonesia "Nov"');
ok(rows[1].tgl === '2026-10-27' && rows[1].lain.join(' ') === '9876543210 BUDI SANTOSO', 'bulan "Okt" & keterangan lanjutan setelah kaki halaman tetap tersambung');
const r = M.ringkasMutasi(rows);
ok(r.debit.length === 2 && r.kredit.length === 1, 'biaya BY TRX tidak dihitung sebagai transfer');
const d1 = r.debit.find(d => d.ref === '100001'), d2 = r.debit.find(d => d.ref === '100002');
ok(d1 && d1.nom === 500000 && d1.rek === '1234567890' && d1.fee === 6500 && d1.tgl === '2026-10-26', 'transfer |000rek|: rekening tanpa nol depan, admin dari jurnal yang sama');
ok(d2 && d2.nom === 300000 && d2.rek === '9876543210' && d2.fee === 0, 'transfer "PEMINDAHAN KE rek" (sesama bank, tanpa admin)');
ok(r.saldoAwal === 2000000 && r.saldoAkhir === 2193500 && r.dari === '2026-10-26' && r.sampai === '2026-11-01' && r.baris === 4 && r.putus === 0, 'saldo awal/akhir & rentang dari urutan nomor; saldo bersambung');

// 3) baris hilang → saldo tidak bersambung
const r2 = M.ringkasMutasi(M.bacaMutasiBNI(lines.filter(l => !/^3\s/.test(l))));
ok(r2.putus === 1, 'satu baris hilang terdeteksi (putus = 1)');
ok(M.bacaMutasiBNI(['Laporan lain', baris('1', '01-Xyz-2026 09:00:00', '1', 'X', 'D', '1', '1', '0', '0')]).length === 0, 'bulan tak dikenal / format lain → tidak ada baris');

// 4) gabung beberapa file: diurutkan menurut tanggal, kesinambungan saldo antarfile dicek
const A = { debit: [{ tgl: '2026-10-26', nom: 1 }], kredit: [], saldoAwal: 100, saldoAkhir: 80, dari: '2026-10-26', sampai: '2026-11-06', baris: 5, putus: 0 };
const B = { debit: [{ tgl: '2026-11-08', nom: 2 }], kredit: [{ tgl: '2026-11-10', nom: 50 }], saldoAwal: 80, saldoAkhir: 120, dari: '2026-11-08', sampai: '2026-11-16', baris: 3, putus: 0 };
const g = M.gabungMutasi([B, A]);
ok(g.dari === '2026-10-26' && g.sampai === '2026-11-16' && g.saldoAwal === 100 && g.saldoAkhir === 120 && g.debit.length === 2 && g.kredit.length === 1 && g.baris === 8 && g.putus === 0, 'gabung 2 file (urutan unggah terbalik) bersambung');
ok(M.gabungMutasi([A, Object.assign({}, B, { saldoAwal: 70 })]).putus === 1, 'file yang tidak bersambung terdeteksi');

console.log(fails ? fails + ' GAGAL' : 'SEMUA LULUS');
process.exit(fails ? 1 : 0);
