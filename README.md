# NC-WA SaaS

WhatsApp gateway untuk banyak pengguna: setiap akun menghubungkan nomornya lewat QR, mengirim pesan lewat API atau n8n, dan bisa memasang Asisten AI yang membalas pelanggan.

Cara kerja dan arsitektur ada di [AGENT.MD](AGENT.MD).

## Fitur

- **Akun dan paket.** Registrasi dan login, peran pengguna dan pemilik, API key per akun, serta paket bulanan dengan kredit dan batas nomor. Paket dasar gratis direset tiap tanggal 1 WIB. Pembayaran memakai QRIS Midtrans. 1 kredit dipakai untuk 1 pesan keluar.
- **Gateway WhatsApp.** Session per akun (Baileys) dengan QR, reconnect, dan pemulihan saat restart. Kirim teks dan media, grup, read, typing, antrean, webhook, event realtime, dan kompatibel dengan node n8n NC-WA.
- **Asisten AI.** AI dipasang per nomor dengan kredit AI terpisah (dihitung per kata). Setiap sesi memakai satu **profil**, yaitu pipeline dari sistem, dan satu **data profil**, yaitu isi milik klien yang bisa dipakai di banyak sesi.
  - **CS Usaha:** knowledge, produk, dan pesanan.
  - **CS Lembaga Pendidikan:** profil lembaga, program, jadwal, dokumen yang dikirim ke WhatsApp, dan kontak. Profil ini tidak menyimpan data pribadi.
  - Juga tersedia: riwayat chat gaya WhatsApp dengan balasan manual, jeda, dan full auto; fallback ke tim; Uji Coba.
  - Pemilik menyetel prompt dan model tiap node di **AI Studio**, dan menyalakan atau mematikan profil di **Profil AI**.
- **Auto Share.** Kontak dan kelompok, template (teks atau media, bisa mengambil data dari endpoint, bisa dirapikan AI), serta pengiriman sekali atau berulang dengan rotasi template dan riwayat per tujuan.
- **Referral**, audit dan status layanan, serta backup dan restore.

Dokumentasi API untuk klien ada di dashboard: **Dokumentasi API**.

## Menjalankan lokal

Kebutuhan: Node.js 22+ dan MySQL 8. Konfigurasi ada di `.env`, yang tidak di-commit.

```sh
npm ci
npm run migrate      # idempoten; wajib setiap ada perubahan skema
npm run dev          # http://127.0.0.1:8067
npm run owner -- email@contoh.id   # jadikan akun terdaftar sebagai pemilik
```

Perintah lain: `npm run check`, `npm run build`, `npm start`, `npm run backup`, `npm run test:isolated`. Cara pengujian dijelaskan di AGENT.MD.

## Update server

```sh
sudo git pull
sudo npm ci            # hanya jika package-lock.json berubah
sudo npm run migrate
sudo npm run build
sudo systemctl restart nc-wa-saas
```

Saat start pertama setelah update, folder lama `auth/` otomatis dipindah ke `storage/`. Jika service memakai `ReadWritePaths` seperti contoh di `deploy/`, buat dulu `storage/` (pemilik user app) dan sesuaikan `ReadWritePaths` sebelum restart.

Contoh service systemd dan nginx ada di `deploy/`. Jika perintah dijalankan dengan sudo, pastikan pemilik file sesuai user yang menjalankan app.

## Struktur

Kode dikelompokkan per komponen bisnis di `src/components/` (`account`, `billing`, `whatsapp`, `ai`, `auto-share`, `referral`). Setiap komponen punya `entry-points/` (rute HTTP), `domain/` (logika), `data-access/` (SQL), dan `index.ts` (API publiknya). Kode bersama ada di `src/libraries/`, perakitan aplikasi di `src/http/`, dan front-end di `public/dashboard/` dan `public/ai-studio/`. Folder `test/` mengikuti struktur `src/`. Folder `scripts/` berisi runner tes, pemeriksaan browser, dan utilitas.

Peta lengkap dan aturan ketergantungannya ada di AGENT.MD.
