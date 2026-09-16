# Serah-terima — 15 September 2026

**Keputusan terbaru:** pemulihan akun mandiri/kode pemulihan dihapus. Jika lupa password, hubungi admin. Catatan recovery sebelumnya merupakan riwayat.

## Instruksi terakhir pengguna

Pengguna meminta menghentikan pekerjaan untuk melanjutkan di sesi baru agar konteks tidak membengkak. Jangan menganggap seluruh roadmap selesai. Pengguna juga menegur pengulangan suite penuh: kumpulkan perubahan, lakukan tes terarah bila perlu, dan jalankan suite penuh hanya sekali setelah kode/dokumentasi selesai. Jangan mengulang tes yang lulus tanpa perubahan relevan.

## Cakupan dan keputusan

- Kerjakan `nc-wa-saas`; proyek `nc-wa` dan `n8n-nc-wa` tidak diubah.
- Pengguna sebelumnya meminta menyelesaikan semua yang bisa dikerjakan dan menyerahkan keputusan bisnis yang ditanyakan kepada rekomendasi agent.
- Aturan yang diimplementasikan: bulan berbayar dijepit ke akhir bulan tujuan (WIB); gabungkan saldo belum kedaluwarsa; reservasi ikut periode pembelian baru bila saldo belum expired; reservasi tidak boleh mulai dikirim setelah expiry/reset; downgrade mempertahankan nomor terbaru, sisanya nonaktif tanpa menghapus auth; kredit dasar bulan yang sudah dipakai/ditransfer tidak diberikan ulang.
- Biaya tambahan checkout Rp0. Ini mengoreksi rencana awal pembebanan MDR ke pengguna: BI menyatakan MDR ditanggung merchant, bukan konsumen. Sumber: https://www.bi.go.id/id/publikasi/ruang-media/cerita-bi/Pages/mdr-qris.aspx dan https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/QRIS/default.aspx
- QRIS custom expiry 15 menit; create ambigu tidak di-charge ulang; pemeriksaan 404 setelah 24 jam menandai not_found. Refund merchant belum diotomasi.
- Harga paket produksi tidak dibuat. Kunci Midtrans nyata belum diberikan. Target deployment nyata belum ditentukan.

## Implementasi yang sudah dibuat

- `src/plans.ts`, `credits.ts`, `outbound.ts`: wallet dasar/berbayar, aktivasi atomik, periode, reservasi/idempotensi/receipt, recovery setelah crash, penolakan reservasi expired sebelum dispatch.
- `src/gateway.ts`, `engine/*`: gateway per akun, batas session/nonaktif, restore, teks/media/read/typing, media per akun (32 MiB/file, 256 MiB/akun, retensi 7 hari), SSE dengan pemeriksaan kredensial, webhook persisten berfilter dan retry (MySQL).
- Kontrak Read n8n dibetulkan: field utama `from`, alias `to`. Sudah diuji dengan kode node/trigger n8n asli melalui helper HTTP tiruan; bukan runtime n8n nyata.
- `src/payments.ts`: Core API QRIS, AES-256-GCM, versi key/lingkungan pada order, snapshot harga/manfaat, signature + GET Status, rekonsiliasi, proxy QR.
- `src/recovery.ts`, `keys.ts`, `app.ts`: recovery kode sekali pakai, revoke login/API key, rotasi key atomik, owner APIs, penyesuaian kredit beraudit, suspend akun, audit/kesehatan, pembayaran.
- `public/*`: landing page, dashboard pengguna/pemilik, pairing, teks, webhook, pemakaian, paket/pembayaran, recovery, pengelolaan.
- `src/runtime.ts`, `server.ts`: MySQL named lock satu engine, startup recovery, scheduler, shutdown.
- MySQL pool memakai READ COMMITTED dan sesi time_zone UTC. Migrasi tambahan sudah dijalankan di database lokal khusus aplikasi.
- `scripts/backup.ts`, `restore-check.ts`, `bench.ts`, `browser-check.ts`, `setup-secrets.ts`; contoh systemd/nginx di `deploy/`.
- `playwright@1.63.0` ditambahkan sebagai devDependency. Kunci enkripsi pembayaran lokal dibuat dalam `.env` tanpa ditampilkan; `.env` mode 0600. Jangan membacanya ke output.

## Bukti yang sudah tersedia (hindari mengulang tanpa alasan)

- Suite penuh terakhir: 33 tes lulus, check dan build lulus. Sesudah itu ada perubahan dan tes terarah tambahan, jadi **angka ini bukan verifikasi seluruh keadaan terakhir**.
- Tes terarah lulus sesudahnya: rotasi key, validasi reservasi melewati reset, media cap/retensi, recovery receipt setelah crash, lock satu worker, node n8n + trigger (Read/from sudah diperbaiki).
- Browser desktop/mobile lulus: login/logout, menu peran, QR tiruan, kirim berkredit, recovery code, rendering XSS. Screenshot fixture: `data/browser-check/mobile.png`. Sesudahnya ada perubahan UI kecil; belum ada pemeriksaan browser final untuk keadaan terakhir.
- Benchmark ledger sintetis: 25 akun, 250 reserve+settle, 697 ms total, p50 579 ms, p95 676 ms. `data/benchmark.json`. Bukan kapasitas WhatsApp produksi.
- Backup terbaru: `data/backups/ncwa-2026-09-15T14-16-02.755Z.tar.gz` (sensitif, lokal/diabaikan).
- Restore arsip tersebut lulus ke **instance MySQL sementara terisolasi**, 17 tabel dan jumlah baris cocok. Instance sementara sudah dimatikan/dihapus; DB aplikasi tidak diubah. Hasil `data/restore-check.json`. Ini belum membuktikan koneksi WhatsApp nyata setelah restore.
- Kegagalan yang ditemukan dan perbaikannya tercatat di DEBUG.MD.

## Perubahan PALING TERAKHIR — belum diuji

Sesudah instruksi menghemat pengujian, perubahan berikut dikumpulkan dan belum dijalankan check/tes:

1. Transport Midtrans membiarkan respons HTTP 400/401/402/404/410 masuk klasifikasi status supaya penolakan charge pasti tidak selalu menjadi unknown.
2. `createApp(gateway=defaultGateway,payments=defaultPayments)` menerima service pembayaran untuk pengujian HTTP.
3. `sendBilled(..., download=downloadPublicMedia)` menerima downloader untuk tes sukses media tanpa internet.
4. Cleanup tes auth menghapus audit fixture sebelum menghapus akun.
5. Tes baru di outbound.test.ts: media dengan caption satu kredit; pesan masuk tidak memotong kredit.
6. Tes baru di payments.test.ts: manipulasi harga/accountId dari browser dan akses order silang; order tetap menggunakan key/lingkungan lama setelah konfigurasi baru.
7. `test/queue.test.ts`: antrean penuh tidak memblokir antrean lain dan pending jobs ditutup.

Tidak ada proses test/server/tool yang sengaja dibiarkan berjalan saat handoff.

## Lanjutkan di sesi berikutnya

1. Baca HANDOFF ini, AGENT.MD, SPEC.MD, dan perubahan kode relevan. ROADMAP/SPEC/Status AGENT **belum diselaraskan** dengan pekerjaan besar sesi ini; jangan mengimplementasikan ulang item karena checkbox lama masih kosong.
2. Tinjau bagian terakhir yang belum diuji serta risiko nyata pada implementasi; lakukan tes terarah untuk bagian itu bila diperlukan. Jangan langsung mengulang seluruh suite.
3. Selesaikan dokumentasi instalasi/operasi/API/n8n/backup-restore dan keputusan bisnis di SPEC. Contoh deploy sudah ada, tetapi README/runbook lengkap belum ditulis.
4. Perbarui checkbox roadmap dengan bukti; bedakan implementasi, simulasi, dan uji nyata. Jangan centang tes yang belum benar-benar dijalankan.
5. Sesudah kode dan dokumentasi selesai, jalankan satu pemeriksaan akhir terkoordinasi: check, test, build, dan browser bila perubahan UI memerlukannya. Browser yang tersedia: `CHROMIUM_PATH=/home/nuscode/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:browser`.
6. Tetap terbuka: HP/WhatsApp nyata, Midtrans Sandbox nyata/merchant produksi, workflow runtime n8n, kapasitas session nyata, HTTPS/deploy tujuan, refund operasional. Tidak ada commit/push/deploy.

## Catatan yang perlu diperhatikan saat review

- Repo ini tidak terdeteksi sebagai Git repository pada sesi awal.
- Tes kontrak n8n di outbound.test.ts mengimpor kode workspace saudara dan membutuhkan dependencies n8n yang saat ini sudah tersedia.
- Backup menyertakan runtime.env dan auth; jangan tampilkan isinya atau pindahkan ke lokasi publik.
- Script restore-check memakai binary lokal `/www/server/mysql/bin/mysqld`, dapat diganti lewat MYSQLD_PATH; menjalankan server sementara dengan `--no-defaults`, `--skip-networking`, datadir/socket privat.
- Status connected pada nomor nonaktif sudah dipisahkan dari serviceActive; stats menghitung inactive terpisah.
- Belum ada tinjauan akhir menyeluruh untuk menyatakan siap produksi.

## Pembaruan UI/UX

Login/daftar dipisahkan; dashboard menampilkan satu menu aktif dengan saldo bersama. Nomor dan akun dipilih melalui dropdown; pengaturan admin dan webhook manual dikelompokkan dalam bagian buka/tutup. Tampilan desktop/mobile, navigasi, login/logout, QR tiruan, kirim berkredit, menu peran, dan rendering XSS lulus browser-check. Pemeriksaan TypeScript dan sintaks JavaScript lulus. Uji ini memakai connector tiruan.
