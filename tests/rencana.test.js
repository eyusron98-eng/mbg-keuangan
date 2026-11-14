// Uji logika Rencana Operasional (blok // <RENCANA-OPS> di src/index.html)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const blok = src.slice(src.indexOf('// <RENCANA-OPS>'), src.indexOf('// </RENCANA-OPS>'));
const R = new Function(blok + '\nreturn { roHari, roPagu, roBatas, roFee, roKodeBank, roBersih, roUsulkan, roRingkas, roMatriks, roLabel };')();
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
const kosong = R.roUsulkan(Object.assign({}, ctx, { riwayat: null }), set, {}, 1);
ok(kosong.items.length === 0 && /manual/.test(kosong.catatan), 'tanpa riwayat: tidak ada usulan, diminta isi manual');

console.log(fails ? '\n' + fails + ' GAGAL' : '\nSEMUA LULUS');
process.exit(fails ? 1 : 0);
