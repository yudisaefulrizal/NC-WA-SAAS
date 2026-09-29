# NC-WA SaaS — Panduan Agent

Baca sebelum mengerjakan proyek ini. Gambaran produk ada di [README.md](README.md).

## Aturan kerja

- Pemilik berkomunikasi dalam bahasa Indonesia. Kerjakan permintaan persis dan tuntas sampai data benar tersimpan, jangan mengambil jalan pintas. Kalau ada keputusan bisnis yang belum jelas, tanyakan dulu.
- Untuk fitur besar, diskusikan pemahaman dan desain dulu (desain dibuat di Claude Design) sebelum menulis kode.
- Commit dan push hanya bila diminta ("commit dan push").
- Jangan menetapkan harga, model billing, atau penyedia tanpa keputusan pemilik.
- Setiap akses data wajib memakai identitas akun dari server (sesi login atau API key), bukan ID dari URL atau body.
- Jangan commit `.env`, `.envpengembangan`, API key, `storage/` (login WhatsApp dan file klien), `data/`, atau salinan database. Log dan catatan tidak boleh memuat isi pesan, QR, atau secret.
- Jangan mengubah proyek lain (`../nc-wa`, `../n8n-nc-wa`) kecuali diminta.

## Pengujian

- **Tes integrasi** (`test/**/*.test.ts`, strukturnya mengikuti `src/`) memakai MySQL dan akun tiruan. Jalankan di MySQL sementara yang terisolasi, supaya tidak bersaing dengan scheduler server dev: `npm run test:isolated`. Runner menjalankan migrasi lalu seluruh tes secara serial. Dengan argumen, runner hanya menjalankan tes atau skrip itu, berurutan: `npm run test:isolated -- test/components/ai/profiles.test.ts scripts/checks/browser-ai-profiles-check.ts`. Atur `MYSQLD_PATH` bila binary MySQL berbeda.
- **Pemeriksaan browser** (`scripts/checks/browser-*-check.ts`, Playwright) diperiksa pada lebar 1280 px dan 390 px. Jalankan lewat runner terisolasi yang sama; `CHROMIUM_PATH` opsional. Tangkapan layarnya disimpan di luar proyek, di `$TMPDIR/ncwa-browser-check/` (biasanya `/tmp/ncwa-browser-check/`).
  - Masih gagal sejak sebelum refactor struktur: `browser-check.ts` (menunggu `#stat-credit` yang kini tersembunyi), `browser-template-source-check.ts`, dan `browser-auto-share-check.ts` (belum mengikuti wizard template tiga tahap).
- **Belum pernah diuji otomatis:** HP WhatsApp nyata, n8n nyata, dan QRIS merchant nyata. Profil AI (graf) belum diuji dengan model AI sungguhan maupun HP WhatsApp nyata; semua tesnya memakai model dan engine tiruan. Tulis "belum diuji" untuk alur yang belum dilakukan.
- Setelah perubahan skema, jalankan `npm run migrate` di database dev. Migrasi harus idempoten dan aman dijalankan ulang.

## Peta kode

Struktur mengikuti Node.js Best Practices: kode dikelompokkan per komponen bisnis, dan setiap komponen punya tiga lapisan yang sama.

| Folder | Isi |
|---|---|
| `src/components/<komponen>/entry-points/` | Rute HTTP: membaca request, memanggil domain, membentuk respons. Tanpa SQL. |
| `src/components/<komponen>/domain/` | Logika bisnis. Tanpa `req`/`res` dan tanpa SQL. |
| `src/components/<komponen>/data-access/` | Satu-satunya tempat SQL: modul `*-queries.ts` (satu fungsi bernama per statement), skema tabel komponen, dan penyimpanan file. |
| `src/components/<komponen>/index.ts` | API publik komponen. |
| `src/libraries/` | Kode bersama tanpa aturan bisnis: `db`, `errors` (`ApiError`), `crypto`, `validation`, `pagination`, `download`, `log`, dan lainnya. |
| `src/http/` | Perakitan: `app.ts` (middleware, urutan rute, halaman), `gateway.ts` (rute klien dan auth API key), `services.ts` (instans yang saling disambungkan). |
| `storage/` (tidak di git) | Data runtime: `whatsapp/<akun>/<sesi>/` berisi login Baileys (jangan dihapus, nomor akan logout), `files/{media,record-files,share-assets}/<akun>/` berisi file klien. Path-nya dari `src/libraries/storage.ts`. Instalasi lama dengan `auth/` dipindah otomatis saat start pertama. |
| `src/server.ts`, `src/migrate.ts` | Titik masuk aplikasi dan migrasi. Skema fondasi ada di `migrate.ts`, skema lain di `data-access/schema.ts` tiap komponen. |
| `public/dashboard/` | Dashboard: `index.html`, `css/*.css`, `js/core.js`, `js/pages/*.js`, `js/start.js`. |
| `public/ai-builder/` | Editor profil pemilik (`index.html`, gaya `editor.css`). Isi koleksi klien dikelola di Asisten AI › Knowledge (`public/dashboard/js/pages/ai-records.js`). |
| `test/` | Tes, dengan jalur yang sama seperti `src/` (`test/components/ai/profiles.test.ts` menguji `src/components/ai`); `test/components/ai/graph-fixture.ts` berisi graf uji bersama untuk tes runtime. |
| `scripts/test/`, `scripts/checks/`, `scripts/tools/` | Runner tes terisolasi, pemeriksaan browser, dan utilitas (`owner`, `backup`, `restore-check`, `setup-*`, `bench`). |

Komponen: `account` (akun, login, API key), `billing` (paket, kredit WhatsApp, pembayaran, kirim berbayar), `whatsapp` (sesi Baileys, pesan, media, event, webhook), `instagram` (Instagram DM lewat Zernio: akun Zernio klien, konektor sesi, webhook, alur hubungkan), `ai` (Asisten AI, profil graf dan Editor profil), `auto-share`, dan `referral`.

**Aturan ketergantungan**
- Arah panggilan: `entry-points` → `domain` → `data-access` → `libraries`. Jangan dibalik.
- Kode di luar sebuah komponen (komponen lain dan `src/http`) hanya mengimpor dari `index.ts` komponen itu. Kalau butuh nama baru, ekspor dulu dari `index.ts`.
- Tes dan skrip boleh mengimpor bagian dalam komponen untuk menyiapkan data.
- Kalau dua komponen saling membutuhkan, pakai interface dan sambungkan instansnya di `src/http/services.ts` (contoh: `Payments` menerima `PurchaseCommissions` dari referral).
- Aturan di atas diperiksa otomatis oleh `scripts/checks/structure.ts` (bagian dari `npm run check`). Import yang hanya tipe (`import type`) boleh ke mana saja karena hilang saat dijalankan. Satu pengecualian: `data-access/schema.ts` (migrasi) boleh memakai konstanta domain seperti alur bawaan dan daftar profil. ESLint tidak dipakai karena typescript-eslint butuh compiler API TypeScript, yang tidak ada di TypeScript 7.
- `tsconfig.json` sengaja memakai `lib: ["ES2022"]` tanpa DOM, supaya variabel yang lupa dideklarasikan (misalnya `origin`) langsung gagal di `tsc`, bukan jatuh ke global browser.

**Menaruh kode baru**
- Rute baru masuk ke `entry-points/routes.ts` komponennya. Bila fungsi pendaftarnya baru, daftarkan di `src/http/app.ts` atau `gateway.ts`.
- Query baru ditulis sebagai fungsi di `data-access/<tabel>-queries.ts` dengan pola `nama(c:Executor,params,...)`. Domain memberi `db` atau koneksi transaksi yang sedang dibuka. Lihat aturan nama query di bawah.
- `AIService` (`ai/domain/service.ts`) hanya berisi delegasi. Isinya ada di modul per tugas: `settings`, `logs`, `wallet`, `trial`, `data-profiles`, `conversations`, dan `runtime`.
- Dashboard memakai skrip klasik `defer` yang berbagi satu scope global dan dijalankan sesuai urutan `<script>` di `index.html`. Kode yang langsung jalan saat dimuat hanya boleh memakai nama dari file sebelumnya; handler event boleh memakai nama dari file mana pun. Urutan `<link>` CSS juga menentukan cascade.
- Halaman diberi hash isi otomatis oleh `page()` di `src/http/app.ts`: setiap `src`/`href` lokal `.js` atau `.css` mendapat `?v=<hash>`.

## Aturan keterbacaan

Tujuannya: siapa pun, manusia atau agent, bisa membuka satu file dan paham isinya tanpa membaca seluruh proyek. Semua kode sudah mengikuti aturan ini; `npm run check` menolak format yang menyimpang dan pelanggaran aturan ketergantungan.

**Format**
- Format diatur Prettier (`.prettierrc.json`), bukan selera. Jalankan `npm run format -- <file>` setelah mengubah file.
- Satu pernyataan per baris. Satu aturan CSS per baris. Jangan menulis kode dalam gaya padat satu baris panjang.

**Komentar**
- Komentar ditulis dalam bahasa Indonesia. Nama variabel, fungsi, dan file tetap bahasa Inggris. Teks yang dilihat pengguna berbahasa Indonesia.
- Setiap file dibuka dengan 1–3 baris komentar: file ini berisi apa dan dipakai oleh siapa.
- Komentar menjelaskan *kenapa*, bukan mengulang *apa* yang sudah terbaca dari kode.

**Modular atau tidak**
Ukuran file dan fungsi bukan patokan, tapi tanda untuk menimbang. Pecah bila hasilnya lebih mudah dibaca:
- file berisi lebih dari satu hal yang bisa dijelaskan terpisah (misalnya carousel sesi dan form pesanan dalam satu file);
- bagian yang sering diubah bercampur dengan bagian yang jarang disentuh;
- pembaca harus menggulir jauh untuk menemukan hal yang dicari.
Jangan pecah bila potongannya selalu harus dibaca bersama, atau bila pemecahan hanya memindahkan kerumitan ke banyak file kecil yang saling bergantung.

**Nama**
- Nama file menyebut isinya, dalam kebab-case: `record-query.ts`, `session-carousel.js`. Nama umum seperti `utils`, `helpers`, `shared`, `data`, `misc` tidak dipakai.
- Query dikelompokkan per tabel di `data-access/<tabel>-queries.ts` dan dipanggil lewat namespace `<tabel>Sql`, dengan nama pendek yang menyebut maksudnya: `import * as filesSql from '../data-access/record-files-queries.js'` lalu `filesSql.lock(c, [...])`, bukan `lockRecordFileByAccountIdDataProfileIdId(...)`.
  - Awalan nama: `find` (satu baris), `list` (banyak baris), `count`/`sum`, `lock` (FOR UPDATE), `share` (FOR SHARE), `insert`, `upsert`, `update`, `delete`, atau kata kerja yang lebih tepat (`markSent`, `publish`). Nama `delete` saja tidak bisa dipakai karena kata tercadang; pakai `deleteById`.
  - Awalan tabel milik komponen itu sendiri tidak diulang: `ai_graph_profiles` di komponen ai menjadi `graph-profiles-queries.ts`, `auto_share_jobs` menjadi `jobsSql`.
  - Query yang tabelnya dipilih saat berjalan diberi modul bernama tugasnya (contoh `session-data-queries.ts`), dan nama tabelnya hanya boleh dari daftar tetap di kode.

**Urutan isi file**
Komentar pembuka, import, tipe, fungsi yang diekspor, lalu helper internal.

## Arsitektur singkat

- **Kredit WhatsApp** dipesan dulu (reservasi) dengan idempotency key sebelum pesan dikirim (`billing/domain/outbound.ts`, `billing/domain/credits.ts`). Hasil kirim yang belum pasti tidak pernah dikirim ulang otomatis.
- **Engine** (`whatsapp/domain/sessions.ts`): satu pemilik aktif per session. Login disimpan di `storage/whatsapp/<akun>/<sesi>/`, dan semua session dipulihkan saat startup.
- **Halaman Chat** (`/dashboard/chat`, `public/dashboard/js/pages/chat.js`, `css/chat.css`): kotak masuk gabungan semua sesi dari `GET /ai/chats` (`listAllChats`), dengan label sesi, ikon platform, filter sesi, dan penanda "Menunggu tim". Riwayat, balas manual, dan jeda/full auto memakai endpoint per sesi yang sama dengan Percakapan Asisten AI; balasan selalu dari sesi asal. Kodenya terpisah dari `ai-chat.js` supaya Asisten AI tidak berubah, tetapi memakai kelas CSS dan helper waktu/centang dari sana.
- **Halaman Integrasi** (`/dashboard/integrasi`, `public/dashboard/js/pages/integrasi.js`): semua sesi WhatsApp dan Instagram dalam satu daftar dengan jatah sesi paket, peringatan koneksi terputus, Hubungkan ulang/Putuskan/Hapus, dan akun penyedia (Zernio). `/dashboard/nomor` lama diarahkan ke sini; API key dan webhook ada di tab "API & Webhook" Asisten AI.
- **Instagram DM lewat Zernio** (`src/components/instagram/`):
  - Sesi Instagram adalah sesi biasa di SessionManager dengan `channel: 'instagram'`; `phone` berisi `@username`. Gateway membungkus konektor WhatsApp dengan `instagram.connector()`: sesi yang ada di `instagram_channels` tersambung lewat Zernio, sisanya Baileys. Jadi AI, kredit, riwayat chat, dan batas sesi paket berlaku sama.
  - Nomor pelanggan adalah ID pengguna Instagram (IGSID, angka hingga 20 digit), yang juga dipakai Zernio sebagai `conversationId` untuk mengirim. ID pesan Instagram diganti hash `ig_…` (`messageIdOf`) karena bisa melewati kolom riwayat chat.
  - Klien boleh punya banyak akun Zernio (`instagram_zernio_accounts`, kunci dan secret webhook terenkripsi). Menambah akun memeriksa kunci dan mendaftarkan webhook ke `APP_ORIGIN/zernio/webhook/<id>` untuk seluruh akun Zernio itu (tanda tangan HMAC dari body mentah, dipasang sebelum parser JSON). Profil Zernio adalah urusan klien: NC-WA tidak membuat atau mengubahnya.
  - Login Instagram tidak pernah dilakukan dari NC-WA (satu profil Zernio memuat satu Instagram, dan login ke profil yang terisi menghapus data akun lamanya). Klien menambah dan menghubungkan ulang akun di dashboard Zernio; NC-WA hanya memasang akun yang sudah aktif. Webhook `account.connected` menyambungkan lagi sesi yang terputus, dan tombol Hubungkan ulang memeriksa status akun di Zernio.
  - Fallback dari sesi Instagram diberitahukan lewat sesi WhatsApp tersambung paling awal di akun itu (`ai_fallbacks.notify_session_id`); balasan tim di WhatsApp diteruskan ke sesi pelanggan pada tiket.
  - Kirim dan balas DM sudah dicoba pemilik dengan akun Zernio dan Instagram sungguhan di server (2026-09-29); tes otomatisnya memakai server Zernio tiruan. Balasan di luar jendela 24 jam Instagram ditolak Meta (belum memakai tag HUMAN_AGENT).
- **Asisten AI**:
  - Semua profil AI adalah graf yang dibuat pemilik melalui Editor profil `/dashboard/admin/ai-builder` (profil statis CS Usaha, CS Lembaga Pendidikan, Tester AI, dan AI Studio sudah dihapus): definisi graf/skema disimpan di `ai_graph_profiles`, versi terbit di `ai_graph_versions`, dan record tenant di `ai_data_records`. Runtime di `domain/builder/engine.ts`; panduan kontrak ada di `docs/dynamic-ai-profiles-design.md`. Tidak perlu menambah tabel atau kode per profil.
  - Node data ada tiga: Data tabel (`data_table`, dulu `tool`), Data teks (`data_text`), dan Data isian (`data_form`), masing-masing untuk koleksi `kind` `list`, `text`, dan `form`; teks/isian disimpan sebagai satu record. Operasinya berjalan lewat satu adapter (`builder/record-tools.ts`): database di runtime dan Uji Coba, memori di simulasi. Semantik filter/kata kunci/urutan ada dua kali, di SQL (`graph-profiles-queries.ts`) dan JavaScript (`record-query.ts`); ubah keduanya bersamaan dan jalankan tes paritas di `builder-data.test.ts`.
  - Koleksi milik pelanggan dibatasi ke `ToolContext.customer` dari sesi, tidak pernah dari argumen model.
  - Koleksi bisa diganti API milik klien per data profil (`builder/collection-sources.ts`, tabel `ai_collection_sources`); pemanggil HTTPS-nya ada di `ai/domain/endpoint.ts`.
  - File field File/gambar ada di `storage/files/record-files/` dan tabel `ai_record_files` (`builder/record-files.ts`). Setiap jalur yang menyalin atau menghapus record/data profil harus ikut menyalin atau menghapus filenya.
  - Daftar profil ada di `ai/domain/profiles/registry.ts`; WhatsApp (`runtime.ts`) dan Uji Coba (`trial.ts`) menjalankan graf terbit lewat `runGraph`. Data profil (`ai_data_profiles`) adalah isi milik akun (perilaku, nomor fallback, record koleksi) yang dipasang ke sesi lewat `ai_assistants.data_profile_id`. Data profil tidak pernah dibuat otomatis; menyalakan AI sesi butuh data profil terpasang.
  - Runtime memanggil `config.checkpoint` sebelum setiap node Data, supaya tidak ada record yang ditulis setelah percakapan dijeda, diambil alih admin, atau asistennya berubah.
  - Kredit AI dihitung per kata, dipesan dulu, lalu diselesaikan setelah jawaban. Memori dan konteks S-P-O disimpan per sesi dan per pelanggan. Di graf, riwayat dibaca lewat node Memori percakapan (`memory`) dan ringkasan lewat node Memori konteks (`context_memory`, hanya ditulis Context); profil tanpa Memori konteks memakai cara lama. Riwayat chat (`ai_chat_messages`) terpisah dari memori AI.
  - Mengganti atau mencabut data profil mengosongkan memori AI sesi itu.
  - Profil baru selalu mulai nonaktif sampai pemilik menyalakannya.
  - Tabel profil statis lama (`ai_products`, `ai_orders`, `ai_product_images`, `ai_data_sources`, `ai_edu_*`, `ai_workflow`) dikosongkan oleh migrasi karena user database aplikasi tidak punya hak DROP; migrasi mencetak perintah `DROP TABLE` untuk dijalankan sekali dengan akun admin MySQL.
- **Menambah profil** dilakukan melalui Editor profil, impor/tempel JSON, atau skill AI, tanpa kode per profil. Menambah jenis node/operasi baru harus memperbarui kontrak, validator, runtime, UI, deskripsi skill AI (`domain/builder/skill.ts`, dipaksa `tsc`), dan tes.
- **Auto Share**: konten dan tujuan disalin ke run saat dijadwalkan. Worker memproses satu run sekaligus, dengan jeda acak 1–3 detik antar tujuan.

## Pelajaran dari kegagalan sebelumnya

- MySQL memakai `time_zone='+00:00'` dan isolasi READ COMMITTED di pool. Tanpa ini, perbandingan waktu dengan UTC_TIMESTAMP meleset dan inisialisasi wallet bisa deadlock.
- Kolom baru di kode tanpa `npm run migrate` menghasilkan `internal_error` saat menyimpan.
- Aset front-end diberi hash isi otomatis saat startup. Kalau perubahan front-end "tidak terlihat", periksa dulu apakah server sudah di-restart.
- `page.waitForFunction` dengan fungsi async selalu langsung lulus. Pakai helper polling `until()` seperti di skrip pemeriksaan profil.
- Memeriksa pratinjau atau payload saja tidak cukup. Uji alur simpan lalu buka ulang secara utuh.
- Dialog `showModal()` berada di atas semua z-index. Notifikasi `#message` memakai popover supaya tetap terlihat di atas dialog.
- Batas JSON 16 KB, kecuali API Editor profil (128 KB, lihat `src/http/app.ts`).
