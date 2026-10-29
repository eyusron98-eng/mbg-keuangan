# Keuangan MBG

Aplikasi keuangan dapur MBG (Koperasi ISS). Satu halaman web (`index.html`, disajikan GitHub Pages)
dengan backend Google Apps Script (lihat [`backend/`](backend/README.md)).

## Struktur
| Berkas | Isi |
|---|---|
| `src/index.html` | **Sumber aplikasi** (React + JSX + kelas Tailwind). Bisa dibuka langsung di browser untuk pengembangan (memakai Babel & Tailwind CDN). |
| `index.html` | **Hasil build** yang dipakai pengguna. Jangan diedit langsung — akan tertimpa saat build berikutnya. |
| `build.js`, `package.json`, `tailwind.config.js`, `src/tailwind.css` | Perangkat build. |
| `backend/` | Cadangan kode Apps Script (ID Spreadsheet/Drive disamarkan). |
| `tests/` | Uji otomatis backend & browser (data tiruan, tanpa akses ke Google). |

## Mengubah aplikasi
1. Ubah `src/index.html`.
2. `npm install` (sekali saja), lalu `npm run build`.
3. `npm test` — semua uji harus lulus.
4. Commit **`src/index.html` dan `index.html`** bersama-sama.

Build menerjemahkan JSX menjadi JavaScript biasa dan menyusun CSS Tailwind sekali saja, sehingga browser
pengguna tidak lagi mengunduh Babel (~600 KB gzip) dan Tailwind CDN, dan tidak menerjemahkan kode di HP.
Recharts (grafik Dashboard) dan SheetJS (ekspor Excel) dimuat hanya saat dibutuhkan.

## Uji otomatis
Semua uji memakai data dan API **tiruan**; tidak menyentuh Google Sheet asli.

| Perintah | Isi |
|---|---|
| `npm run test:backend` | Logika `backend/Code.gs` di Node dengan layanan Apps Script tiruan: hash password & migrasi, batas percobaan login, pencabutan sesi, hak akses per peran, pengajuan ganda (`request_id`), Berita Acara, penanda tangan Laporan. |
| `npm run test:e2e` | Aplikasi `index.html` di Chromium: login lewat POST, sinkron saldo antar periode, pengajuan (tab, duplikat, koneksi putus), persetujuan per peran, Berita Acara, Laporan, Riwayat (saldo saat difilter, ganti dapur, ekspor Excel), posisi modal, grafik. |
| `npm test` | Keduanya. |

Uji browser butuh Chromium: `npx playwright install chromium`, atau arahkan ke Chromium yang sudah ada dengan
`CHROMIUM_PATH=/path/ke/chromium`. Opsi lain: `ONLY="Riwayat"` (hanya uji yang namanya memuat teks itu),
`DBG=1` (cetak isi halaman saat gagal), `HTML=src/index.html` (uji sumber/mode pengembangan).

Saat mengubah backend: perbarui `backend/Code.gs`, jalankan `npm run test:backend`, lalu tempel ke Apps Script
(isi kembali dua ID — lihat `backend/README.md`).
