# NC-WA SaaS

Ruang pengembangan versi NC-WA untuk banyak pengguna dengan kredit atau langganan bulanan.

Status: fondasi akun dan dashboard lokal berjalan. Katalog paket dan kredit dasar tersedia; gateway WhatsApp, kredit pengiriman, serta pembayaran belum diimplementasikan.

Lihat [SPEC.MD](SPEC.MD) untuk kebutuhan, keputusan terbaru, dan hal yang masih perlu dibahas.

## Dokumen proyek

- [AGENT.MD](AGENT.MD) — panduan kerja dan status saat ini.
- [SPEC.MD](SPEC.MD) — spesifikasi awal sesuai diskusi multi-user.
- [ROADMAP.MD](ROADMAP.MD) — urutan pengerjaan dan checklist pengujian.
- [DEBUG.MD](DEBUG.MD) — catatan percobaan perbaikan yang gagal.

Pembayaran menggunakan QRIS Midtrans Core API; pengaturan kredensial khusus pemilik layanan. Satuan pemakaian adalah 1 kredit per pesan keluar yang diterima WhatsApp untuk dikirim. Paket bulanan dibatasi kredit; default gratis 1 nomor/100 kredit direset tanggal 1 WIB dan dapat diatur pemilik. Database memakai MySQL dan integrasi memakai node n8n yang sudah ada. Harga paket berbayar diatur pemilik; detail transisi dan operasional tersisa tercantum di SPEC.MD.

## Pengembangan lokal

Stack awal: Node.js 22+, TypeScript, Express, mysql2, dan HTML/CSS/JS tanpa framework. MySQL lokal terkonfirmasi 8.0.45.

Konfigurasi runtime ada di `.env` (akun database aplikasi khusus). `.envpengembangan` hanya untuk kredensial administrasi/sandbox; tidak dimuat runtime dan tidak di-commit.

```sh
npm ci
npm run migrate
npm run check
npm test
npm run build
npm run dev
```

Buka `http://127.0.0.1:8067`. Daftar dengan email dan password minimal 6 karakter, lalu login. Untuk menjadikan akun milik Anda sebagai pemilik, jalankan di terminal lokal:

```sh
npm run owner -- email-anda@example.com
```

Registrasi selalu membuat peran pengguna; promosi pemilik hanya melalui administrasi terminal. Akun pemilik dapat melihat daftar akun. Semua akun dapat membuat dan mencabut API key. Uji key memakai `GET /api/client/me` dengan header `X-API-Key`; endpoint ini khusus fondasi. Endpoint `/stats`, session, serta webhook belum tersedia, sehingga kredensial n8n belum dapat diuji terhadap SaaS.

Tes memakai akun acak di database konfigurasi `.env`, lalu membersihkannya. Jangan jalankan tes dengan koneksi produksi. Migrasi saat ini membuat tabel fondasi secara idempoten; migrasi perubahan skema bertahap perlu ditambahkan saat model paket dibuat. Jika lupa password, hubungi admin.

## Paket dan kredit dasar

Akun baru mendapat kuota paket dasar (default 100 kredit/1 nomor). Saldo terlihat di dashboard. Pemilik dapat membuat/mengedit katalog Paket & Harga; paket dasar harus tetap gratis dan aktif. Harga paket berbayar diisi pemilik, belum ada checkout.

Reset dasar diperiksa saat saldo dibuka, berdasarkan bulan WIB, dan mengganti sisa kredit memakai konfigurasi terbaru. Perubahan katalog tidak langsung mengubah saldo akun yang sedang berjalan. Reset terjadwal dan penerapan batas nomor pada engine belum tersedia.

## Pembaruan session dan kredit

Session WhatsApp per akun tersedia lewat `/sessions`, QR, logout, reconnect, hapus, filter, serta `/stats`. Modul engine diadaptasi dari NC-WA ke `src/engine`; proyek lama tidak diubah. Auth state berada pada `auth/<account-id>/`. Dashboard menyediakan pairing QR. Restore session saat ini dilakukan saat akun pertama mengakses gateway setelah restart, belum pemulihan seluruh akun otomatis saat startup.

Scheduler kredit dasar berjalan saat startup dan setiap 30 detik; akses saldo juga memeriksa periode WIB. Reservasi kredit persisten tersedia sebagai layanan internal: retry ID sama tidak memotong ulang, timeout menahan saldo, dan kegagalan pada periode lama tidak menambah kuota periode baru. Belum dihubungkan ke pengiriman nyata.

Verifikasi terbaru: 11 tes lulus, pemeriksaan tipe dan build lulus. Uji isolasi session/QR dan batas nomor memakai connector tiruan. Belum ada scan HP atau pengujian browser otomatis. API kirim, webhook, media masuk, paket berbayar, downgrade, serta pemulihan akun masih belum selesai. Hanya uji kredensial `/stats` dan operasi session node n8n yang kini tersedia; jangan menganggap seluruh integrasi n8n sudah siap.


## Asisten AI

Jalankan `npm run migrate`, kemudian buka **Pengaturan AI** pada dashboard pemilik. Isi endpoint Chat Completions HTTPS, API key, model, tarif kata, harga jual per 1.000 kredit, dan batas memori. Tarif awal input 1/output 2; harga 0 menonaktifkan pembelian. Key terenkripsi memakai `PAYMENT_ENCRYPTION_KEY` yang sama dengan pembayaran. Untuk konfigurasi pengembangan yang sudah ada, gunakan `npx tsx --env-file=.env scripts/setup-ai.ts --test`; file `.envpengembangan` tidak dibaca runtime atau dikirim ke browser.

Pengguna membuka **Asisten AI**, memilih nomor, mengisi pengetahuan/perilaku, lalu mengaktifkan asisten. Saldo AI dan WhatsApp harus tersedia. Pembelian AI memakai konfigurasi QRIS Midtrans yang sudah ada dan tidak mengubah paket WhatsApp. Saldo AI tidak kedaluwarsa. Jeda per pelanggan dan hapus konteks tersedia di halaman yang sama.

Endpoint dashboard: `GET /api/ai/wallet`, `GET /api/ai/usage`, `POST /api/ai/payments`; pengaturan per sesi `GET/PUT /sessions/:id/ai`, percakapan `GET /sessions/:id/ai/conversations`, `PUT /sessions/:id/ai/conversations/:customer` dengan `{paused, clear?}`. Identitas akun selalu berasal dari autentikasi. Endpoint pemilik: `GET/PUT /api/admin/ai`, `POST /api/admin/ai/test`, `POST /api/admin/accounts/:id/ai-credits` dengan `{amount, reason, requestId}`.

Aturan billing, batas input/output, memori, dan pemulihan restart dijelaskan pada [rencana dan implementasi AI](plane-fitur-ai.md#10-implementasi--16-september-2026). Restart tidak mengulangi pengiriman ambigu. Harga jual, QRIS merchant nyata, dan uji HP harus diselesaikan sebelum membuka layanan ke pelanggan.

## Auto Share

Menu `/dashboard/auto-share` dipisahkan menjadi empat bagian:

- **Daftar Kontak**: nomor internasional/ID grup dan kelompok, unik per akun. Tombol Simpan ke kontak juga tersedia di Ambil alih percakapan AI.
- **Template Pesan**: konten yang dapat dipakai ulang, tanpa sesi, tujuan, atau jadwal. Mendukung teks/link, gambar, video, dokumen, dan audio. Media memakai URL file HTTP/HTTPS publik (bukan upload lokal); gambar/video/dokumen dapat memiliki caption dan link. Audio tanpa caption. Pengunduhan memakai validasi alamat publik, pembatasan ukuran, dan timeout pada jalur media yang sudah ada.
- **Pengiriman / Jadwal**: sesi pengirim, kontak/kelompok tujuan, urutan satu atau beberapa template, serta jadwal sekali/setiap jam/hari/minggu. Tambahkan template ke urutan dan gunakan Naik/Turun untuk mengatur giliran. Satu eksekusi memilih satu template untuk seluruh tujuan, lalu giliran berikutnya menggunakan template selanjutnya dan kembali ke awal.
- **Riwayat Pengiriman**: 100 run terakhir beserta nama pengiriman, template yang dipakai, dan hasil per tujuan.

Rotasi disimpan di database dan maju ketika jadwal berhasil masuk antrean, termasuk jika pengiriman nantinya gagal. Jadwal yang dilewati karena run masih aktif atau tujuan kosong tidak menggeser rotasi. Mengubah urutan template memulai rotasi dari awal; perubahan pengaturan lain mempertahankan posisi. Klik **Kirim** pada pengiriman dan pilih template untuk kirim manual, tanpa menggeser rotasi jadwal. Template yang masih digunakan pengiriman tidak dapat dihapus.

Waktu formulir mengikuti zona waktu browser dan disimpan UTC. Pengulangan menggunakan interval tetap; jadwal yang terlewat saat server mati dijalankan sekali kemudian dimajukan, tanpa mengirim seluruh jadwal lampau. Tidak perlu memasang cron sistem.

Pengiriman berurutan memakai mengetik 1 detik, jeda acak hardcode 1–3 detik antar tujuan, serta kredit WhatsApp yang sama dengan API. Tujuan dari kontak/kelompok dideduplikasi saat run dibuat. Snapshot konten, URL media, dan tujuan disimpan di run; perubahan template atau kontak tidak mengubah run yang sudah antre (isi file pada URL media harus dijaga oleh pemilik URL). Gagal pada satu tujuan tidak menghentikan tujuan lain. Hasil yang belum pasti tidak dikirim ulang otomatis. Maksimal 32 run aktif/antre per akun; worker memproses satu run pada satu waktu.

Jalankan `npm run migrate` dan `npm run build` sebelum menjalankan versi baru. Tabel: `daftar_kontak`, `auto_share_templates`, `auto_share_jobs`, `auto_share_runs`, `auto_share_deliveries`. Migrasi memisahkan setiap template lama menjadi konten dan satu pengiriman dengan satu template, mempertahankan tujuan, sesi, jadwal, dan riwayat. Kolom jadwal lama dipertahankan untuk kompatibilitas data tetapi tidak lagi dipakai worker; migrasi berulang tidak membuat ulang pengiriman yang telah dihapus.

Verifikasi memakai MySQL sementara dan transport tiruan, lalu dibersihkan otomatis:

```sh
npx tsx --env-file=.env scripts/test-auto-share.ts
# Regresi penuh (ada kegagalan tes batas memori AI pada database baru, lihat DEBUG.MD):
npx tsx --env-file=.env scripts/test-auto-share.ts --all
```

Sesuaikan `MYSQLD_PATH` jika binary MySQL lokal berbeda. Tes antrean hanya aktif dalam runner terisolasi agar tidak bersaing dengan worker pengembangan. WhatsApp nyata perlu diuji terpisah.
