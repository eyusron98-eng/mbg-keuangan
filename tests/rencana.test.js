// Uji logika Rencana Operasional (blok // <RENCANA-OPS> di src/index.html)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const blok = src.slice(src.indexOf('// <RENCANA-OPS>'), src.indexOf('// </RENCANA-OPS>'));
const R = new Function(blok + '\nreturn { roHari, roPagu, roBatas, roFee, roKodeBank, roBersih, roUsulkan, roRingkas, roMatriks, roLabel, roStatusBaris, roLepasBatal, roGeserLebih, roAdminBB };')();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const periode = { id: 'P19', periode_no: 19, tanggal_mulai: '2026-11-09', tanggal_akhir: '2026-11-20', penerima: 1000 };
const penerima = [{ id: 'WANDA', nama: 'Wanda', bank: 'BANK SYARIAH INDONESIA' }, { id: 'GAS', nama: 'PT Gas', bank: 'BANK MANDIRI' }, { id: 'TOKO', nama: 'Toko', bank: 'BNI' }];
// riwayat 5 hari layanan: honor & PIC harian, gas besar, sabun, APD
const tx = [];
['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].forEach(t => {
  tx.push({ tanggal: t, kategori: 'Gaji/honor relawan pekerja SPPG', uraian: 'Pembayaran Honor Relawan ' + t.slice(8) + ' November 2026', nominal: 1500000, penerima_id: 'WANDA' });
  tx.push({ tanggal: t, kategori: 'Insentif Guru/PIC Sekolah', uraian: 'Insentif PIC Sekolah', nominal: 100000, penerima_id: 'WANDA' });
});
tx.push({ tanggal: '2026-11-03', kategori: 'Gas', uraian: 'Isi gas 12kg 10 tabung tgl 3 November', nominal: 2400000, penerima_id: 'GAS' });
tx.push({ tanggal: '2026-11-04', kategori: 'Alat Kebersihan', uraian: 'Sabun cuci', nominal: 200000, penerima_id: 'TOKO' });
tx.push({ tanggal: '2026-11-05', kategori: 'APD', uraian: 'Masker & sarung tangan', nominal: 300000, penerima_id: 'TOKO' });
const ctx = { periode, penerima, bankVA: 'BSI', riwayat: { periode_no: 18, hari: 5, tx }, aktual: {} };
const set = { indeks: 100, batas: 95 };

const hari = R.roHari(periode, {});
ok(hari.length === 12 && hari.filter(h => !h.libur).length === 10 && hari.find(h => h.tanggal === '2026-11-14').libur, 'periode 12 hari: 10 HPE, Sabtu/Minggu libur');
ok(R.roPagu(hari[0], set) === 3000000 && R.roBatas(hari[0], set) === 2850000, 'pagu = 3.000 × 1.000 PM; batas 95%');
ok(R.roPagu(R.roHari(periode, { '2026-11-09': { pm: 800 } })[0], set) === 2400000, 'PM hari itu bisa disesuaikan');
ok(R.roPagu(R.roHari(periode, {})[0], { indeks: 110, batas: 95 }) === 3300000, 'indeks kemahalan 110% menaikkan pagu');
ok(R.roKodeBank('BANK SYARIAH INDONESIA') === 'BSI' && R.roFee({ penerima_id: 'WANDA' }, { WANDA: penerima[0] }, 'BSI') === 0 && R.roFee({ penerima_id: 'GAS' }, { GAS: penerima[1] }, 'BSI') === 6500, 'biaya transfer: sesama BSI gratis, beda bank Rp 6.500');
ok(R.roBersih('Isi gas 12kg 10 tabung tgl 3 November') === 'Isi gas 12kg 10 tabung' && R.roBersih('Pembayaran Honor Relawan 04 November 2026') === 'Pembayaran Honor Relawan', 'tanggal dibuang dari uraian lama');

const u = R.roUsulkan(ctx, set, {}, 1);
const s = R.roRingkas(u.items, ctx, set, {});
ok(u.items.filter(x => x.rutin && x.kategori.startsWith('Gaji')).length === 10 && u.items.filter(x => x.rutin && x.kategori.startsWith('Insentif Guru')).length === 10, 'rutin harian (honor, PIC) terjadwal di setiap HPE');
ok(s.hari.every(h => h.pakai <= h.batas), 'tidak ada hari melebihi batas: ' + s.hari.map(h => h.pakai).join(','));
const gas = u.items.filter(x => x.kategori === 'Gas');
ok(gas.length === 4 && gas.every(x => x.bagian && x.bagian.endsWith('/2')) && gas.reduce((a, x) => a + x.nominal, 0) === 4800000, 'gas: 1× per 5 hari → 2× untuk 10 HPE; tiap Rp 2,4 jt (lebih dari sisa pagu harian) dipecah 2 kali beli (' + gas.map(x => x.nominal + ' ' + x.bagian).join(', ') + ')');
ok(new Set(gas.map(x => x.tanggal)).size === gas.length, 'bagian gas di hari berbeda');
ok(s.takMuat === 0 && s.kurang === 0, 'semua kebutuhan muat (' + s.takNilai + ')');
const u2 = R.roUsulkan(ctx, set, {}, 2);
const pola = x => x.items.filter(i => !i.rutin).map(i => i.kategori + i.tanggal).sort().join();
ok(pola(u) !== pola(u2), 'usulan ulang (seed lain) menghasilkan susunan hari berbeda');
const u3 = R.roUsulkan(Object.assign({}, ctx, { periode: Object.assign({}, periode, { id: 'P20' }) }), set, {}, 1);
ok(pola(u) !== pola(u3), 'periode berbeda → susunan berbeda');
// baris yang sudah diajukan dipertahankan & tidak dobel
const tetap = [{ id: 'X', tanggal: '2026-11-09', kategori: 'Gaji/honor relawan pekerja SPPG', nominal: 1500000, penerima_id: 'WANDA', pengajuan_id: 'PA1' }];
const u4 = R.roUsulkan(ctx, set, {}, 3, tetap);
ok(!u4.items.some(x => x.tanggal === '2026-11-09' && x.kategori.startsWith('Gaji')), 'honor yang sudah diajukan tidak diusulkan dobel');
// pagu sempit: kebutuhan tidak muat ditandai jujur
const sempit = Object.assign({}, ctx, { periode: Object.assign({}, periode, { penerima: 560 }) });
const u5 = R.roUsulkan(sempit, set, {}, 1), s5 = R.roRingkas(u5.items, sempit, set, {});
ok(s5.takMuat > 0 && s5.takNilai > 0 && s5.hari.every(h => h.pakai <= h.pagu || u5.items.filter(x => x.tanggal === h.tanggal && !x.rutin).length === 0), 'pagu tidak cukup → sisa kebutuhan "tidak muat" (' + s5.takNilai + '), tidak dipaksakan ke hari mana pun');
ok(!u5.items.some(x => x.bagian && x.nominal < 250000), 'belanja kecil tidak dipecah');
{ const m = R.roMatriks(u5.items, sempit, set, {});
  ok(m.kolom[0] === 'Gaji/honor relawan pekerja SPPG' && m.kolom[1] === 'Insentif Guru/PIC Sekolah', 'kolom matriks: pos rutin di depan (' + m.kolom.map(R.roLabel).join(', ') + ')');
  const takTot = Object.keys(m.tak).reduce((a, k) => a + m.tak[k], 0);
  ok(takTot === s5.takNilai && m.kolom.every(k => m.terjadwal[k] + (m.tak[k] ? m.takItems[k].reduce((a, x) => a + x.nominal, 0) : 0) === u5.items.filter(x => x.kategori === k).reduce((a, x) => a + x.nominal, 0)), 'baris Terjadwal + Tidak muat per pos = total kebutuhan pos');
  ok(m.sel['2026-11-09']['Gaji/honor relawan pekerja SPPG'].nominal === 1500000 && !m.sel['2026-11-14'], 'sel hari × pos berisi nominal; Sabtu kosong'); }
{ const ctxS = Object.assign({}, ctx, { riwayat: Object.assign({}, ctx.riwayat, { tx: ctx.riwayat.tx.concat(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map(t => ({ tanggal: t, kategori: 'Sewa Kendaraan', uraian: 'Sewa minibus', nominal: 270000, penerima_id: 'WANDA' }))) }) });
  const us = R.roUsulkan(ctxS, set, {}, 1);
  ok(!us.items.some(x => x.kategori === 'Sewa Kendaraan'), 'Sewa Kendaraan tidak lagi diusulkan (rutin maupun kebutuhan)'); }
{ const ul = R.roUsulkan(ctx, set, {}, 1, [], '2026-11-12');
  ok(ul.items.length > 0 && ul.items.every(x => !x.tanggal || x.tanggal >= '2026-11-12'), 'tanggal sebelum hari ini tidak dijadwalkan');
  ok(ul.items.filter(x => x.rutin && x.kategori.startsWith('Gaji')).length === 7, 'honor hanya untuk 7 HPE tersisa (12–20 Nov)'); }
{ const ul = R.roUsulkan(ctx, set, {}, 1, [], '2026-11-16'), r = R.roRingkas(ul.items, ctx, set, {}, '2026-11-16');
  ok(r.nAktif === 5 && r.paguAktif === 15000000 && r.paguTot === 30000000 && r.nLewat === 5, 'pagu sisa = 5 HPE tersisa (16–20 Nov) = 15 jt, bukan 30 jt sepuluh hari (' + r.paguAktif + ')');
  ok(r.rencanaAktif <= r.paguAktif && r.kebutuhanAktif === r.rencanaAktif + r.takNilai, 'rencana aktif & kebutuhan dihitung dari hari tersisa');
  const m = R.roMatriks(ul.items.concat([{ id: 'L', tanggal: '2026-11-10', kategori: 'Gas', uraian: 'lama', nominal: 999000, penerima_id: 'GAS' }]), ctx, set, {}, '2026-11-16');
  ok(!(m.terjadwal['Gas'] >= 999000) || ul.items.filter(x => x.kategori === 'Gas' && x.tanggal).reduce((a, x) => a + x.nominal, 0) === m.terjadwal['Gas'], 'baris Terjadwal di matriks tidak menghitung tanggal yang sudah lewat'); }
{ const its = [{ id: 'a', pengajuan_id: 'PA1', nomor: 'N1' }, { id: 'b', pengajuan_id: 'PA2', nomor: 'N2' }, { id: 'c', pengajuan_id: 'PA2', nomor: 'N2' }, { id: 'd' }];
  const st = { PA1: ['DIBATALKAN'], PA2: ['DISETUJUI', 'DITOLAK'] };
  const sb = R.roStatusBaris(its, st);
  ok(sb.a === 'DIBATALKAN' && sb.b === 'DISETUJUI' && sb.c === 'DITOLAK' && sb.d === undefined, 'status per baris dipetakan menurut urutan di pengajuan');
  const l = R.roLepasBatal(its, st);
  ok(l.lepas === 2 && !l.items[0].pengajuan_id && l.items[0].batal === 'dibatalkan' && l.items[1].pengajuan_id === 'PA2' && !l.items[2].pengajuan_id && l.items[2].batal === 'ditolak',
    'baris yang dibatalkan/ditolak dilepas (bisa diubah & diajukan lagi), yang disetujui tetap terkunci');
  ok(R.roLepasBatal(its, {}).lepas === 0, 'status belum diketahui → tetap terkunci'); }
{ // Senin PM diturunkan → lebih pagu; geser memindah/memecah ke hari lain, rutin & yang diajukan tetap
  const its = [{ id: 'H', tanggal: '2026-11-09', kategori: 'Gaji/honor relawan pekerja SPPG', nominal: 1500000, penerima_id: 'WANDA', rutin: true },
    { id: 'G', tanggal: '2026-11-09', kategori: 'Gas', nominal: 2400000, penerima_id: 'WANDA' }, { id: 'A', tanggal: '2026-11-09', kategori: 'APD', nominal: 300000, penerima_id: 'WANDA', pengajuan_id: 'PA1' }]
    .concat(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(t => ({ id: 'H' + t, tanggal: t, kategori: 'Gaji/honor relawan pekerja SPPG', nominal: 1500000, penerima_id: 'WANDA', rutin: true })));
  const hs = { '2026-11-09': { pm: 700 } };   // pagu Senin 2,1 jt; isi 4,2 jt
  const pr = Object.assign({}, periode, { tanggal_akhir: '2026-11-13' }), c2 = Object.assign({}, ctx, { periode: pr });
  const g = R.roGeserLebih(its, c2, { indeks: 100, batas: 100 }, hs, '2026-11-09');
  const r2 = R.roRingkas(g.items, c2, { indeks: 100, batas: 100 }, hs, '2026-11-09');
  ok(g.sisaLebih === 0 && r2.nLebih === 0, 'geser otomatis: tidak ada hari melebihi pagu (' + r2.hari.map(h => h.pakai + '/' + h.pagu).join(' ') + ')');
  ok(g.items.find(x => x.id === 'H').tanggal === '2026-11-09' && g.items.find(x => x.id === 'A').tanggal === '2026-11-09', 'baris rutin & yang sudah diajukan tidak digeser');
  ok(g.items.filter(x => x.kategori === 'Gas').reduce((a, x) => a + x.nominal, 0) === 2400000, 'nominal gas utuh setelah dipindah/dipecah'); }
{ // periode penuh: hari lewat dihitung terpisah; PM & HPE hari lewat bisa diubah (pagu periode ikut)
  const its = [{ id: 'a', tanggal: '2026-11-09', kategori: 'Gas', nominal: 3500000, penerima_id: 'WANDA', luar: true, status: 'TEREALISASI' },
    { id: 'b', tanggal: '2026-11-16', kategori: 'Gas', nominal: 2000000, penerima_id: 'WANDA' }];
  const r1 = R.roRingkas(its, ctx, { indeks: 100, batas: 100 }, {}, '2026-11-16');
  ok(r1.nHpe === 10 && r1.paguTot === 30000000 && r1.pakaiLewat === 3500000 && r1.nLebihLewat === 1 && r1.lebihLewat === 500000 && r1.rencanaAktif === 2000000,
    'periode penuh: pagu 10 HPE, pemakaian hari lewat & kelebihannya dihitung (' + [r1.paguTot, r1.pakaiLewat, r1.lebihLewat].join('/') + ')');
  const r2 = R.roRingkas(its, ctx, { indeks: 100, batas: 100 }, { '2026-11-10': { libur: true }, '2026-11-09': { pm: 1200 } }, '2026-11-16');
  ok(r2.nHpe === 9 && r2.paguTot === 30000000 - 3000000 + 600000 && r2.nLebihLewat === 0, 'hari lewat bukan HPE & PM hari lewat diubah → pagu periode ikut (' + r2.paguTot + ')'); }
{ // biaya admin transfer bahan baku ikut menghabiskan pagu LPDH
  const c2 = Object.assign({}, ctx, { adminBB: { '2026-11-09': 91000, '2026-11-16': 13000 } }), s2 = { indeks: 100, batas: 100, bb: 10 };
  const hh = R.roHari(periode, {});
  const h09 = hh.find(h => h.tanggal === '2026-11-09'), h16 = hh.find(h => h.tanggal === '2026-11-16'), h17 = hh.find(h => h.tanggal === '2026-11-17'), h14 = hh.find(h => h.tanggal === '2026-11-14');
  ok(R.roAdminBB(h09, s2, c2, '2026-11-16') === 91000 && R.roAdminBB(h16, s2, c2, '2026-11-16') === 65000 && R.roAdminBB(h17, s2, c2, '2026-11-16') === 65000 && R.roAdminBB(h14, s2, c2, '2026-11-16') === 0,
    'admin bahan baku: hari lewat = nyata (91.000); hari ini & depan = cadangan 10 × 6.500 (bila nyata lebih kecil); libur tanpa cadangan');
  const r0 = R.roRingkas([], ctx, { indeks: 100, batas: 100 }, {}, '2026-11-16'), r1 = R.roRingkas([], c2, s2, {}, '2026-11-16');
  ok(r1.pakaiLewat === 91000 && r1.rencanaAktif === 65000 * 5 && r0.rencanaAktif === 0, 'ringkasan: admin bahan baku masuk pemakaian (lewat ' + r1.pakaiLewat + ', aktif ' + r1.rencanaAktif + ')');
  ok(R.roMatriks([{ id: 'x', tanggal: '2026-11-17', kategori: 'Gas', nominal: 100000, penerima_id: 'GAS' }], c2, s2, {}, '2026-11-16').fee['2026-11-17'] === 6500 + 65000, 'kolom biaya transfer = admin operasional + admin bahan baku');
  const g = R.roGeserLebih([{ id: 'g1', tanggal: '2026-11-17', kategori: 'Gas', nominal: 2950000, penerima_id: '' }], ctx, { indeks: 100, batas: 100, bb: 10 }, {}, '2026-11-16', []);
  ok(g.items[0].tanggal !== '2026-11-17' || g.sisaLebih > 0, 'geser otomatis memperhitungkan cadangan admin bahan baku (hari itu tinggal 2.935.000)');
  const u2 = R.roUsulkan(ctx, { indeks: 100, batas: 100, bb: 10 }, {}, 1, [], '2026-11-16'), r2 = R.roRingkas(u2.items, ctx, { indeks: 100, batas: 100, bb: 10 }, {}, '2026-11-16');
  ok(r2.nLebih === 0, 'usulan otomatis tetap muat pagu setelah cadangan admin bahan baku (' + r2.nLebih + ' hari lebih)');
}
const kosong = R.roUsulkan(Object.assign({}, ctx, { riwayat: null }), set, {}, 1);
ok(kosong.items.length === 0 && /manual/.test(kosong.catatan), 'tanpa riwayat: tidak ada usulan, diminta isi manual');

console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
process.exit(fails ? 1 : 0);
