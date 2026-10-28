# Backend Keuangan MBG (Google Apps Script)

Cadangan kode backend yang berjalan di Apps Script. **Repo ini publik**, jadi dua ID di bawah sengaja
diganti tanda pengganti. Selain dua baris itu, `Code.gs` di sini sama persis dengan yang terpasang.

| Konstanta | Isi saat memulihkan |
|---|---|
| `SPREADSHEET_ID` | ID Google Sheet "Anggaran MBG" (bagian URL antara `/d/` dan `/edit`) |
| `DRIVE_FOLDER_ID` | ID folder Drive tempat bukti transaksi disimpan |

Versi terpasang dapat dicek di `<URL web app>/exec?action=ping` (mis. `v6-ba-sec4`).

## Memulihkan / memasang ulang
1. Salin Google Sheet sebagai cadangan (**File → Make a copy**) sebelum mengubah apa pun.
2. Buka Sheet → **Extensions → Apps Script** → `Code.gs`.
3. Tempel isi `backend/Code.gs`, lalu isi kembali `SPREADSHEET_ID` dan `DRIVE_FOLDER_ID`. **Ctrl+S**.
4. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (jangan membuat deployment baru,
   agar URL web app di `index.html` tetap sama).
5. Cek `?action=ping`.

## Peringatan
- **Jangan jalankan `setupSheets()`** pada data asli: fungsi itu mengosongkan sheet dan menanam akun bawaan.
- `migrasiHashPassword()` aman diulang; hanya meng-hash password yang belum ter-hash.
- Password tersimpan sebagai hash (`h1$garam$hash`). Kode sebelum `sec1` membandingkan teks biasa,
  jadi **jangan kembali ke versi sebelum `sec1`** setelah migrasi — tidak ada yang bisa login.

## Riwayat versi
- `sec1` — password di-hash, `getUsers` tanpa password, batas percobaan login, cabut sesi saat ganti password,
  `request_id` mencegah pengajuan ganda.
- `sec2` — Berita Acara untuk asisten; `getBADaftar` bisa dibatasi (hari ini / periode aktif / satu periode).
- `sec3` — `getPenandatangan`: nama akuntan dapur untuk tanda tangan Laporan.
- `sec4` — `LOGIN_VIA_GET_DIBOLEH = false`: login & aksi berpassword lewat GET ditolak.
