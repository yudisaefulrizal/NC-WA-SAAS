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
