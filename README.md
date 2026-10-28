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

## Mengubah aplikasi
1. Ubah `src/index.html`.
2. `npm install` (sekali saja), lalu `npm run build`.
3. Commit **`src/index.html` dan `index.html`** bersama-sama.

Build menerjemahkan JSX menjadi JavaScript biasa dan menyusun CSS Tailwind sekali saja, sehingga browser
pengguna tidak lagi mengunduh Babel (~600 KB gzip) dan Tailwind CDN, dan tidak menerjemahkan kode di HP.
Recharts (grafik Dashboard) dan SheetJS (ekspor Excel) dimuat hanya saat dibutuhkan.
