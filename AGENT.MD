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

- **Tes integrasi** (`test/**/*.test.ts`, strukturnya mengikuti `src/`) memakai MySQL dan akun tiruan. Jalankan di MySQL sementara yang terisolasi, supaya tidak bersaing dengan scheduler server dev: `npm run test:isolated`. Runner menjalankan migrasi lalu seluruh tes secara serial. Dengan argumen, runner hanya menjalankan tes atau skrip itu, berurutan: `npm run test:isolated -- test/components/ai/edu.test.ts scripts/checks/browser-ai-edu-check.ts`. Atur `MYSQLD_PATH` bila binary MySQL berbeda.
- **Pemeriksaan browser** (`scripts/checks/browser-*-check.ts`, Playwright) diperiksa pada lebar 1280 px dan 390 px. Jalankan lewat runner terisolasi yang sama; `CHROMIUM_PATH` opsional. Tangkapan layarnya disimpan di luar proyek, di `$TMPDIR/ncwa-browser-check/` (biasanya `/tmp/ncwa-browser-check/`).
  - Masih gagal sejak sebelum refactor struktur: `browser-check.ts` (menunggu `#stat-credit` yang kini tersembunyi), `browser-template-source-check.ts`, dan `browser-auto-share-check.ts` (belum mengikuti wizard template tiga tahap).
- **Belum pernah diuji otomatis:** HP WhatsApp nyata, n8n nyata, QRIS merchant nyata, dan model AI sungguhan. Tulis "belum diuji" bila belum dilakukan.
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
| `storage/` (tidak di git) | Data runtime: `whatsapp/<akun>/<sesi>/` berisi login Baileys (jangan dihapus, nomor akan logout), `files/{media,product-images,ai-documents,share-assets}/<akun>/` berisi file klien. Path-nya dari `src/libraries/storage.ts`. Instalasi lama dengan `auth/` dipindah otomatis saat start pertama. |
| `src/server.ts`, `src/migrate.ts` | Titik masuk aplikasi dan migrasi. Skema fondasi ada di `migrate.ts`, skema lain di `data-access/schema.ts` tiap komponen. |
| `public/dashboard/` | Dashboard: `index.html`, `css/*.css`, `js/core.js`, `js/pages/*.js`, `js/start.js`. |
| `public/ai-studio/` | Halaman AI Studio pemilik. |
| `test/` | Tes, dengan jalur yang sama seperti `src/` (`test/components/ai/edu.test.ts` menguji `src/components/ai`). |
| `scripts/test/`, `scripts/checks/`, `scripts/tools/` | Runner tes terisolasi, pemeriksaan browser, dan utilitas (`owner`, `backup`, `restore-check`, `setup-*`, `bench`). |

Komponen: `account` (akun, login, API key), `billing` (paket, kredit WhatsApp, pembayaran, kirim berbayar), `whatsapp` (sesi Baileys, pesan, media, event, webhook), `ai` (Asisten AI, profil, AI Studio), `auto-share`, dan `referral`.

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
- Nama file menyebut isinya, dalam kebab-case: `order-schema.ts`, `session-carousel.js`. Nama umum seperti `utils`, `helpers`, `shared`, `data`, `misc` tidak dipakai.
- Query dikelompokkan per tabel di `data-access/<tabel>-queries.ts` dan dipanggil lewat namespace `<tabel>Sql`, dengan nama pendek yang menyebut maksudnya: `import * as ordersSql from '../data-access/orders-queries.js'` lalu `ordersSql.lockOwned(c, [...])`, bukan `lockOrdersIdByAccountIdDataProfileIdId(...)`.
  - Awalan nama: `find` (satu baris), `list` (banyak baris), `count`/`sum`, `lock` (FOR UPDATE), `share` (FOR SHARE), `insert`, `upsert`, `update`, `delete`, atau kata kerja yang lebih tepat (`markSent`, `publish`). Nama `delete` saja tidak bisa dipakai karena kata tercadang; pakai `deleteById`.
  - Awalan tabel milik komponen itu sendiri tidak diulang: `ai_orders` di komponen ai menjadi `orders-queries.ts` / `ordersSql`, `auto_share_jobs` menjadi `jobsSql`.
  - Query yang tabelnya dipilih saat berjalan diberi modul bernama tugasnya (contoh `session-data-queries.ts`), dan nama tabelnya hanya boleh dari daftar tetap di kode.

**Urutan isi file**
Komentar pembuka, import, tipe, fungsi yang diekspor, lalu helper internal.

## Arsitektur singkat

- **Kredit WhatsApp** dipesan dulu (reservasi) dengan idempotency key sebelum pesan dikirim (`billing/domain/outbound.ts`, `billing/domain/credits.ts`). Hasil kirim yang belum pasti tidak pernah dikirim ulang otomatis.
- **Engine** (`whatsapp/domain/sessions.ts`): satu pemilik aktif per session. Login disimpan di `storage/whatsapp/<akun>/<sesi>/`, dan semua session dipulihkan saat startup.
- **Asisten AI**:
  - Profil adalah pipeline di kode (`ai/domain/profiles/registry.ts` + `Pipeline` di `ai/domain/pipeline/runner.ts`): router, specialist, context, tool, dan tier model. Data profil (`ai_data_profiles`) adalah isi milik akun yang dipasang ke sesi lewat `ai_assistants.data_profile_id`.
  - Alur AI Studio disimpan per profil di `ai_workflow`, dengan draft dan publish masing-masing.
  - Kredit AI dihitung per kata, dipesan dulu, lalu diselesaikan setelah jawaban. Memori dan konteks S-P-O disimpan per sesi dan per pelanggan. Riwayat chat (`ai_chat_messages`) terpisah dari memori AI.
  - Mengganti atau mencabut data profil mengosongkan memori AI sesi itu.
  - Profil baru selalu mulai nonaktif sampai pemilik menyalakannya.
  - Pipeline dengan satu specialist (Tester AI) tidak memakai router maupun node Context, karena ringkasan Context hanya dibaca router (`usesRouter` di `pipeline/runner.ts`).
  - **Tester AI** menyimpan Peran pelanggan di kolom `behavior`. Pesan manual (dari HP atau dashboard) di sesi Tester AI tidak menjeda AI: pesan itu masuk memori sebagai ucapan tester dan membatalkan balasan yang sedang dibuat, sedangkan status Jeda tidak diubah (`applyManualReply` di `conversations.ts`). Tester AI menunggu 3–8 detik sebelum membalas supaya dua bot tidak saling membalas secepat kilat.
- **Menambah profil baru** butuh:
  - folder `ai/domain/profiles/<profil>/` berisi `pipeline.ts` dan tool-nya, lalu daftarkan di `profiles/registry.ts`;
  - tabel di `ai/data-access/schema.ts`, query di `ai/data-access/<profil>-queries.ts`, dan endpoint di `ai/entry-points/routes.ts`;
  - tool yang didaftarkan di `defaultTools` (`pipeline/runner.ts`);
  - simulasi di `ai/domain/studio.ts`;
  - tata letak kanvas di `layouts` di `public/ai-studio/studio.js`;
  - sub-tab Knowledge-nya di dashboard (`knowledgeTabsFor` di `js/pages/ai.js`, dan satu file `js/pages/ai-<profil>.js`);
  - tes di `test/components/ai/`.
- **Auto Share**: konten dan tujuan disalin ke run saat dijadwalkan. Worker memproses satu run sekaligus, dengan jeda acak 1–3 detik antar tujuan.

## Pelajaran dari kegagalan sebelumnya

- MySQL memakai `time_zone='+00:00'` dan isolasi READ COMMITTED di pool. Tanpa ini, perbandingan waktu dengan UTC_TIMESTAMP meleset dan inisialisasi wallet bisa deadlock.
- Kolom baru di kode tanpa `npm run migrate` menghasilkan `internal_error` saat menyimpan.
- Aset front-end diberi hash isi otomatis saat startup. Kalau perubahan front-end "tidak terlihat", periksa dulu apakah server sudah di-restart.
- `page.waitForFunction` dengan fungsi async selalu langsung lulus. Pakai helper polling `until()` seperti di skrip pemeriksaan profil.
- Memeriksa pratinjau atau payload saja tidak cukup. Uji alur simpan lalu buka ulang secara utuh.
- Dialog `showModal()` berada di atas semua z-index. Notifikasi `#message` memakai popover supaya tetap terlihat di atas dialog.
- Batas JSON 16 KB, kecuali endpoint teks panjang tertentu (64 KB, lihat `largeText` di `src/http/app.ts`) dan AI Studio (128 KB).
