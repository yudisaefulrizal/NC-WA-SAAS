# NC-WA SaaS — Panduan Agent

## Rencana fitur AI — 16 September 2026

Target Asisten AI dicatat di [plane-fitur-ai.md](plane-fitur-ai.md). Dokumen memisahkan kesepakatan, usulan versi pertama, dan keputusan terbuka. Belum ada implementasi AI; perubahan ini hanya dokumentasi.

**Keputusan terbaru:** pemulihan akun mandiri/kode pemulihan dihapus. Jika lupa password, hubungi admin. Catatan recovery sebelumnya merupakan riwayat.

Dibaca saat mulai mengerjakan proyek ini.

- Apa yang dibangun → [SPEC.MD](SPEC.MD)
- Urutan pengerjaan → [ROADMAP.MD](ROADMAP.MD)
- Percobaan perbaikan yang gagal → [DEBUG.MD](DEBUG.MD)

## Aturan kerja

- Pemilik sudah meminta implementasi dimulai. Kerjakan sesuai roadmap; keputusan bisnis yang belum final tetap ditandai.
- Saat implementasi diminta, ikuti roadmap dan kebutuhan dalam spesifikasi. Instruksi terbaru pemilik menjadi acuan utama.
- Pisahkan kebutuhan hasil diskusi, usulan teknis, dan keputusan yang masih terbuka. Jangan menetapkan harga, model billing, atau penyedia pembayaran tanpa keputusan pemilik.
- Kerjakan versi baru di folder ini. Jangan mengubah `../nc-wa` atau `../n8n-nc-wa` tanpa cakupan pekerjaan yang memerlukannya.
- Gunakan proyek lama sebagai referensi kemampuan dan kontrak API, bukan sebagai bukti bahwa SaaS sudah lolos uji.
- Setiap akses data harus membawa identitas akun yang diverifikasi server. Jangan mengandalkan ID pada URL atau penyaringan di tampilan saja.
- Perbarui roadmap dan bagian Status setelah menyelesaikan pekerjaan. Tandai selesai hanya jika ada hasil nyata.
- Catat percobaan perbaikan yang gagal di DEBUG.MD beserta buktinya sebelum mengganti pendekatan.

## Pengujian

- **[agent]**: pemeriksaan otomatis/lokal, termasuk simulasi akun, engine, dan pembayaran.
- **[manual]**: pengujian HP WhatsApp, n8n nyata, dan lingkungan pembayaran/deploy yang dipilih.
- Tes manual yang belum tersedia boleh ditunda sambil melanjutkan pekerjaan independen; tetap tulis belum diuji.
- Sebelum peluncuran, isolasi antarakun, pencatatan tagihan, pemulihan restart, serta alur WhatsApp dan n8n harus diverifikasi.
- Perintah tersedia: `npm ci`, `npm run migrate`, `npm run check`, `npm test`, `npm run build`, dan `npm run dev`. Tes integrasi memakai akun tiruan di database lokal dan membersihkannya. Jangan arahkan `.env` tes ke produksi.

## Git dan data sensitif

- Buat perubahan dalam kelompok kecil yang sesuai item roadmap. Ikuti arahan pemilik tentang commit dan push.
- Siapkan `.gitignore` sebelum menambahkan kode atau konfigurasi lokal ke Git.
- Jangan commit `.env`, API key, password, kredensial pembayaran, auth WhatsApp, media pelanggan, atau salinan database produksi.
- Log dan bukti debug harus menyamarkan data sensitif; jangan menyimpan isi pesan atau QR mentah dalam catatan.

## Database pengembangan lokal

- Pemilik memilih MySQL dan sudah berhasil mengakses aaPanel lokal.
- Pemilik mengizinkan pembuatan database lokal untuk pengembangan NC-WA SaaS saat implementasi dimulai. Database `nc_wa_saas` dan akun aplikasi khusus sudah dibuat.
- Kredensial administrasi lokal ada di `.envpengembangan` atas permintaan pemilik; jangan menyalinnya ke dokumentasi, source code, log, atau repository. Runtime memakai `.env` dengan akun database khusus.
- Gunakan root hanya untuk administrasi awal. Buat database dan akun aplikasi khusus dengan izin terbatas pada database NC-WA SaaS; aplikasi tidak memakai root.
- Simpan konfigurasi koneksi aplikasi dalam `.env` lokal yang diabaikan Git. Jangan mengubah database atau akun proyek lain.
- Versi server MySQL terkonfirmasi 8.0.45 melalui koneksi lokal terautentikasi.

## Deploy

Target deploy belum ditentukan. Jangan menyalin domain, port, direktori produksi, atau perintah restart proyek lama sebagai konfigurasi SaaS yang sudah berlaku.

Engine harus menjaga satu pemilik aktif per session WhatsApp. Banyak proses tidak boleh membuka auth session yang sama. Database dan auth state harus bertahan setelah restart/redeploy.

## Status

**Tahap:** 2 — katalog paket dan kredit dasar berjalan; tahap 1 masih menyisakan pemulihan akun.

**Selesai:** TypeScript/Express, MySQL 8.0.45 dengan database/user khusus, migrasi akun/sesi/API key/audit, registrasi/login/logout, dashboard bersama, pembuatan/pencabutan key, pemeriksaan role pemilik, serta CLI promosi akun terdaftar ke pemilik. Kontrak engine/n8n telah ditinjau; node lama tidak diubah.

**Verifikasi:** `npm run check`, `npm test` (6 tes dengan rangkaian assertion integrasi MySQL/HTTP), dan `npm run build` lulus. Belum ada uji browser interaktif atau WhatsApp nyata pada SaaS.

**Berikutnya:** lengkapi pemulihan akun dan pengujian keamanan fondasi; tahap 2 paket/kredit, lalu adaptasi session/gateway. `/stats` dan rute gateway n8n belum diimplementasikan. Registrasi sudah memberi kredit dasar atomik; dashboard menampilkan saldo dan pengaturan katalog pemilik. Reset bulanan WIB diperiksa saat saldo diakses, aman terhadap request bersamaan. Scheduler, reservasi kirim, dan aktivasi paket berbayar belum tersedia.

## Pembaruan session dan kredit

Session WhatsApp per akun tersedia lewat `/sessions`, QR, logout, reconnect, hapus, filter, serta `/stats`. Modul engine diadaptasi dari NC-WA ke `src/engine`; proyek lama tidak diubah. Auth state berada pada `auth/<account-id>/`. Dashboard menyediakan pairing QR. Restore session seluruh akun terdaftar kini berjalan otomatis sebelum HTTP dibuka saat startup; akses gateway memakai manager yang sama.

Scheduler kredit dasar berjalan saat startup dan setiap 30 detik; akses saldo juga memeriksa periode WIB. Reservasi kredit persisten tersedia sebagai layanan internal: retry ID sama tidak memotong ulang, timeout menahan saldo, dan kegagalan pada periode lama tidak menambah kuota periode baru. Belum dihubungkan ke pengiriman nyata.

Verifikasi terbaru: 11 tes lulus, pemeriksaan tipe dan build lulus. Uji isolasi session/QR dan batas nomor memakai connector tiruan. Belum ada scan HP atau pengujian browser otomatis. API kirim, webhook, media masuk, paket berbayar, downgrade, serta pemulihan akun masih belum selesai. Hanya uji kredensial `/stats` dan operasi session node n8n yang kini tersedia; jangan menganggap seluruh integrasi n8n sudah siap.

## Status terbaru — 15 September 2026

Pemulihan session saat startup selesai dengan verifikasi pemilik MySQL; akun yatim dilewati dan session logout tetap logout. Restore bersamaan tidak menggandakan connector. Pemeriksaan tipe, 13 tes MySQL/HTTP/connector tiruan, dan build lulus. Belum ada uji restart/QR dengan WhatsApp nyata. Berikutnya: pengiriman berkredit dan webhook; downgrade menunggu rincian transisi paket pada SPEC bagian 10. Catatan status lebih awal di atas merupakan riwayat implementasi.

## Handoff aktif — pekerjaan dihentikan atas permintaan pengguna

Baca [HANDOFF.MD](HANDOFF.MD) sebelum melanjutkan. Implementasi sesi terbaru jauh melampaui status historis di atas; ROADMAP/SPEC belum diselaraskan. Ada perubahan terakhir yang belum diuji. Pengguna meminta menghindari pengulangan suite penuh: tes terarah saat diperlukan, satu suite penuh di akhir.

## Status terbaru — tabel akun admin, 16 September 2026

Halaman `/dashboard/admin/accounts` menampilkan nama paket aktif, sisa kredit, dan kedaluwarsa dalam WIB. Paket dasar menampilkan keterangan reset kredit tanggal 1 pukul 00.00 WIB. Endpoint admin mengambil saldo melalui layanan wallet yang sama dengan dashboard pengguna agar reset/expiry diterapkan sebelum ditampilkan.

Verifikasi: pemeriksaan tipe, sintaks JavaScript, build, dan browser-check desktop/mobile lulus. Suite penuh: 44/45 lulus; tes downgrade session gagal karena mengharapkan `session_inactive`, sementara engine mengembalikan `session_suspended` (di luar perubahan tabel akun).

Pembaruan permintaan pengguna: kolom Kedaluwarsa dihapus dari tabel akun admin; Paket aktif dan Sisa kredit tetap ditampilkan. Pemeriksaan sintaks JavaScript lulus.

Pembaruan tabel pembayaran admin, 16 September 2026: `/dashboard/admin/payments` menampilkan Email menggantikan ID akun. Endpoint admin menyertakan `account_email` melalui LEFT JOIN akun agar baris pembayaran tetap ditampilkan. Pemeriksaan tipe, sintaks JavaScript, build, dan validasi query MySQL (LIMIT 0, tanpa menampilkan data pelanggan) lulus.

Pembaruan tabel audit admin, 16 September 2026: `/dashboard/admin/health` menampilkan Email menggantikan ID akun. Endpoint audit menyertakan `account_email` melalui LEFT JOIN; audit tanpa akun tetap ditampilkan dengan tanda — pada email. Pemeriksaan tipe, sintaks JavaScript, build, dan validasi query MySQL (LIMIT 0) lulus.

Pembaruan rencana AI: `plane-fitur-ai.md` disesuaikan dengan Quick Start SumoPod yang diberikan pengguna dan nama konfigurasi AI dalam `.envpengembangan`. Penyedia awal SumoPod, model awal `deepseek-v4-flash`; nilai API key tidak disalin. Kontrak usage dan akses model belum diuji dengan API nyata. Perubahan hanya dokumentasi.

Pembaruan perencanaan AI: dokumen target dirapikan dan aturan kredit diganti menjadi jumlah kata input/output × tarif masing-masing yang diatur pemilik. Token penyedia bukan dasar potongan kredit pelanggan. Detail teknis dipadatkan; usulan dan keputusan terbuka tetap ditandai. Belum ada implementasi atau pengujian AI.


## Status terbaru — implementasi AI, 16 September 2026

Asisten AI tersedia per nomor dengan pengaturan pengguna dan pemilik, saldo/riwayat berbasis kata, memori global, jeda dan hapus konteks, serta QRIS per 1.000 kredit tanpa kedaluwarsa. Default input 1/output 2, harga jual harus diisi pemilik. Koneksi SumoPod nyata berhasil; key lokal diimpor terenkripsi tanpa dicetak. Lihat aturan operasional, reservasi, kegagalan, dan restart pada plane-fitur-ai.md bagian 10. Status perencanaan AI sebelumnya adalah riwayat.

Perbaikan pendukung: pemeriksaan nomor nonaktif karena batas paket kini mendahului status suspend internal pada `connected()`, agar kontraknya konsisten dengan QR dan tes downgrade yang sebelumnya gagal. Tidak ada perubahan mekanisme pengiriman atau aktivasi paket.

Verifikasi AI: check/build/sintaks JavaScript dan browser desktop/mobile lulus. Suite penuh 55/56 sebelum perbaikan batas body; tes terarah AI/keamanan 12/12 lulus sesudah perbaikan. Pembayaran 8/8 lulus. Tes downgrade historis kini lulus. Tidak ada commit/push/deploy. Harga jual AI tetap 0 sampai ditetapkan pemilik. Runtime pengembangan yang sudah berjalan memakai tsx watch.

## Pembaruan balasan AI natural — 16 September 2026

Asisten menunggu acak 0,2–1 detik, menandai pesan dibaca, lalu mengirim composing sejak sebelum generasi dan menyegarkannya setiap 8 detik hingga jawaban terkirim (urutan diubah 24 September 2026; sebelumnya composing baru dikirim setelah jawaban siap diikuti jeda 1–3 detik), mengirim jawaban, lalu paused melalui finally. Read/presence best effort tanpa kredit tambahan; pemeriksaan pembatalan dipertahankan selama jeda. Check/build dan 13/13 tes AI lulus. Uji HP nyata belum dilakukan.

## Pembaruan ambil alih otomatis — 16 September 2026

Event pesan keluar manual kini menjeda AI per pelanggan dan menyimpan balasan admin ke memori. Connector menentukan dan menyimpan ID sistem sebelum sendMessage; tabel `ai_message_origins` persisten mencegah pesan AI/API dan duplikat memicu jeda. History lama/grup/protokol diabaikan; nomor LID dipetakan bila tersedia. Migrasi lokal sudah dijalankan. Check/build, 21 tes AI/incoming, serta tes regresi incoming/outbound lulus. Uji HP/Web nyata belum dilakukan. Detail batas deteksi ada di plane-fitur-ai.md bagian 12.

## Pembaruan pembelian unit kredit AI — 17 September 2026

Dashboard AI kini menerima jumlah 1–100 unit saat membeli kredit; satu unit tetap 10.000 kredit sesuai harga satuan yang diatur pemilik. Total rupiah dan kredit dihitung serta disimpan sebagai snapshot order di server, sehingga nilai dari browser tidak dipercaya. Satu pembayaran pending dengan jumlah berbeda tetap harus diselesaikan terlebih dahulu. Pemeriksaan TypeScript, suite tes, dan browser desktop/mobile lulus. QRIS merchant nyata belum diuji.

## Pembaruan ganti password pelanggan — 17 September 2026

Pemilik dapat mengganti password akun pelanggan dari tabel Akun pelanggan. Password dibatasi 6–128 karakter, di-hash server, dan seluruh sesi login pelanggan dicabut atomik setelah perubahan. Perubahan diaudit; akun pemilik tetap tidak dapat diubah melalui halaman ini. Pemeriksaan TypeScript, 66 tes, dan browser desktop/mobile lulus.

## Pembaruan ganti password mandiri — 17 September 2026

Setiap akun dapat mengganti password dari tombol Ganti password di header dashboard dengan memasukkan password saat ini dan konfirmasi password baru. Sesi browser yang melakukan perubahan dipertahankan, sesi login lain dicabut, dan perubahan dicatat dalam audit. Pemeriksaan TypeScript, 67 tes, dan browser desktop/mobile lulus.

## Multi-agent internal — 17 September 2026

Asisten sekarang menggunakan router delapan kategori → satu spesialis → tools dengan shared memory MySQL per akun/session/pelanggan. Source `src/ai-agents.ts`, integrasi `src/ai.ts`; tidak memakai n8n. Migrasi lokal menambah mode demo per asisten dan agent pada riwayat penggunaan, mempertahankan data/pengaturan lama. UI menyediakan mode demo eksplisit serta kolom agent. Adapter `AITools` dapat diganti untuk database/API nyata; tools pesanan saat ini hanya simulasi bila demo aktif.

Verifikasi: TypeScript/build, 76/76 tes regresi, serta browser desktop/mobile lulus. Smoke test provider nyata gagal HTTP 401; key lokal sama dengan key tersimpan, keduanya tidak diubah atau dicetak. Perlu key valid untuk menguji model nyata; HP WhatsApp belum diuji untuk engine baru. Detail dan perintah ada di AI-MULTI-AGENT.md. Perubahan pengguna yang sudah ada dipertahankan; tidak ada commit/push/deploy.

## Keputusan client dan implementasi sumber data — 17 September 2026

Konfigurasi aktif kini Knowledge, Produk/Layanan, Order/Pesanan, dan Perilaku AI. Produk dan Order masing-masing default tabel bawaan, dapat diganti independen menjadi endpoint HTTPS client. Mode demo prototype dihentikan. Knowledge hanya melalui tool agent Informasi/Konsultasi/Dukungan/Keluhan; Perilaku dan shared memory dipakai seluruh agent termasuk router, mengikuti keputusan pengguna terbaru.

`src/ai-data.ts` menyediakan tabel/adapter, validasi, snapshot harga order, idempotensi persisten, token terenkripsi, dan pengamanan endpoint. UI mencakup tambah/edit/nonaktifkan produk, pencatatan order, status/catatan, pemilihan sumber, serta panduan endpoint. Tabel terikat akun/session; pembacaan order oleh agent juga dibatasi pelanggan. Data lokal tetap tersedia ketika endpoint dipilih; tidak ada sinkronisasi otomatis ke remote.

Migrasi lokal, build, 86/86 tes regresi, dan browser desktop/mobile termasuk validasi error formulir lulus. Order merupakan pencatatan permintaan berstatus baru; belum dibayar dan tidak mengurangi stok otomatis. Endpoint client nyata dan HP WhatsApp belum diuji; provider terakhir 401 belum berubah. Dokumen aktif: AI-MULTI-AGENT.md. Tidak ada commit/push/deploy.

## Status Auto Share — 18 September 2026

Auto Share diimplementasikan pada menu pengguna `/dashboard/auto-share`: daftar kontak/kelompok, template teks dengan sesi pengirim, kirim manual/jadwal sekali atau interval, serta riwayat per tujuan. Pintasan kontak AI hanya aktif jika nomor belum terdaftar. Pengiriman berkredit memakai mengetik 1 detik dan jeda acak 1–3 detik; snapshot run persisten, deduplikasi, dan recovery tanpa retry hasil tidak pasti. Migrasi lokal sudah dijalankan. Pengujian memakai runner MySQL sementara `scripts/test-auto-share.ts` agar tidak bersaing dengan dev scheduler. Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

Bukti akhir Auto Share: 5/5 tes backend dan browser desktop/mobile lulus, check/build/sintaks/diff lulus. Regresi penuh database sementara 118/119 lulus, dengan satu kegagalan batas memori AI di luar Auto Share (lihat DEBUG.MD). Navbar menyesuaikan tinggi aktual agar tambahan menu tidak menutupi judul pada ponsel. Perubahan lokal AI/paginasi yang sudah ada dipertahankan.

### Refaktor Auto Share — 18 September 2026

Template sekarang hanya konten (teks/link atau URL gambar/video/dokumen/audio). Pengiriman/jadwal pada auto_share_jobs menyimpan tujuan, sesi, urutan template, dan posisi rotasi; satu template untuk semua tujuan per jadwal. Manual memilih template tanpa mengubah rotasi. Migrasi mempertahankan data lama dan tidak menghidupkan lagi pengiriman yang dihapus. Media memakai jalur download publik dan billing existing. Tujuh tes backend serta browser desktop/mobile lulus; build TypeScript selesai. Pengiriman WhatsApp nyata belum diuji.

### Sumber data endpoint pada template Auto Share — 23 September 2026

Template Auto Share dapat menandai `source_mode='endpoint'` dan menarik nilai dari endpoint HTTPS pengguna saat pengiriman dibuat, baik manual maupun terjadwal. Logika murni berada di `src/auto-share-source.ts` (`parsePlaceholders`, `renderTemplate`, `validateSourceData`, `validateSourceMedia`, `sourceInput`) agar dapat diuji tanpa database maupun jaringan; transport `fetchSource` dan pengunduh media disuntikkan melalui `createAutoShare` sehingga tes memakai tiruan.

Pengambilan data berjalan di `prefetchSource` sebelum `beginTransaction`, karena `enqueue` memegang `accountLock` dan `lockJob FOR UPDATE`; menempatkan panggilan HTTP di dalamnya akan menahan kunci akun dan memblokir tick untuk semua akun. `runId` dibuat di prefetch agar media sementara dapat disimpan sebelum baris run ditulis, dan `enqueue` memverifikasi template hasil prefetch masih sama dengan yang terpilih setelah kunci didapat.

Media dari sumber disimpan lewat `AssetStore.saveTemporary` dengan `run_id` terisi: melewati pemeriksaan kuota, memakai batas 8 MB, dan jenisnya tetap disahkan `sniffMediaType` dari byte asli. Seluruh query galeri serta perhitungan kuota kini menyaring `run_id IS NULL`, sehingga media sumber tidak pernah ikut dihitung. Pembersihan dua lapis: `removeRunAssets` saat run selesai atau gagal, dan `sweepTemporary` di `recover()` sebagai jaring pengaman setelah proses terhenti.

Kegagalan sumber dibungkus `ApiError('invalid_request')` agar jatuh ke cabang pencatatan run gagal yang sudah ada di `schedule()`; `next_at` tetap bergeser sehingga satu endpoint mati tidak menghentikan jadwal permanen. Error non-`ApiError` akan menghentikan tick untuk semua akun, jadi `fetchSource` menjamin semua kegagalan jaringan terbungkus.

Bukti: 13/13 tes Auto Share lulus pada MySQL sementara, regresi penuh 141/142 dengan satu kegagalan batas memori AI yang sudah tercatat di DEBUG.MD dan berada di luar Auto Share. TypeScript check, build, dan sintaks JavaScript lulus. Pemeriksaan browser tidak berjalan karena `scripts/browser-auto-share-check.ts` berhenti pada `saveAssistant`; kegagalan ini pra-eksisting dan diverifikasi dengan menjalankan runner pada pohon kerja bersih (lihat DEBUG.MD). Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

### Form sumber data dipilih di awal dan header bebas — 23 September 2026

Dialog template disusun ulang mengikuti urutan keputusan: nama, sumber data, jenis konten, lalu teks. Sumber data berada di awal karena menentukan bentuk field di bawahnya; memilih "Tidak ada" mengembalikan form ke bentuk sebelum fitur ini. Opsi media "Dari endpoint" disembunyikan selama sumber data belum aktif, sehingga penambal auto-reset pada versi sebelumnya tidak lagi diperlukan. Daftar variabel dipindah ke atas kolom teks agar terlihat saat menulis pesan.

Bearer token tunggal diganti header bebas: `validateHeaders` menolak nama di luar `[A-Za-z0-9-]`, header yang diatur transport (`Host`, `Content-Length`, `Connection`, `Accept-Encoding`, dan sejenisnya), nilai bermuatan CRLF yang dapat menyuntikkan header tambahan, nama ganda tanpa memandang huruf besar-kecil, serta batas 10 header dan 1024 karakter. Seluruh header disimpan terenkripsi sebagai satu JSON di `source_secret`; `decodeHeaders` masih mengenali token tunggal versi lama sebagai `Authorization: Bearer`, jadi template lama tidak perlu migrasi. Nilai kosong pada form berarti "pertahankan yang tersimpan" sehingga rahasia tidak perlu diketik ulang, dan mengganti URL endpoint tetap melepas seluruh header.

Verifikasi browser dipisah ke `scripts/browser-template-source-check.ts` karena `browser-auto-share-check.ts` tersandung regresi halaman AI di luar Auto Share (lihat DEBUG.MD). Bukti: 14/14 tes Auto Share lulus, regresi penuh 142/143 dengan satu kegagalan batas memori AI pra-eksisting, pemeriksaan browser form baru lulus pada desktop dan ponsel, TypeScript check dan build lulus. Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

### Kontrak sumber data menerima respons apa adanya — 23 September 2026

`validateSourceData` tidak lagi mewajibkan pembungkus `data`. Bila respons memuat key `data` berisi objek, isinya yang dibaca; bila tidak, objek akar dipakai langsung. Endpoint yang sudah berjalan karena itu tidak perlu direstrukturisasi. Pada respons tanpa pembungkus, key `media` berisi objek dilewati agar tidak ditolak sebagai nilai yang bukan teks, karena key itu memang blok media.

Batas panjang nilai dinaikkan dari 200 menjadi 1000 karakter setelah pengujian terhadap `https://mahadalyusro.sch.id/cekpsb`, yang mengembalikan kalimat statistik siap pakai sepanjang 379–516 karakter per kunci. Pola itu sah dan justru praktis: perakitan kalimat terjadi di sisi penyedia data, template hanya menempelkan. Nama variabel juga menerima huruf besar agar kunci `camelCase` tetap berlaku.

Batasan yang tetap dipertahankan: objek datar saja, tanpa array maupun objek bersarang. Melonggarkannya berarti membangun bahasa query mini (`{{santri[0].nama}}`) yang membuat kegagalan sulit dijelaskan kepada pengguna; jalan keluarnya adalah meratakan respons di sisi penyedia data.

Bukti: 14/14 tes Auto Share lulus, regresi penuh 142/143 dengan satu kegagalan batas memori AI pra-eksisting, pemeriksaan browser form lulus pada desktop dan ponsel, TypeScript check dan build lulus. Substitusi diverifikasi terhadap respons nyata endpoint tersebut. Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

### Media sumber data dipilih dari variabel — 23 September 2026

`validateSourceMedia` tidak lagi membaca blok `media` khusus dari respons, melainkan menerima peta variabel hasil `validateSourceData` beserta nama variabel yang dipilih pengguna (`auto_share_templates.media_variable`). Konsekuensinya kontrak endpoint menjadi satu bentuk saja: objek datar berisi variabel, sebagian di antaranya kebetulan berupa alamat file. Key `media` karena itu kehilangan arti khusus, dan pengecualian yang sempat ditambahkan pada `validateSourceData` dihapus kembali.

Nama berkas diturunkan dari segmen terakhir path URL, sehingga penyedia data tidak perlu mengirim `filename`. Jenis media tetap disahkan `sniffMediaType` dari byte asli setelah diunduh, jadi variabel yang menunjuk file dengan jenis tidak sesuai template tetap ditolak.

Di dashboard, daftar pilihan variabel media diisi dari hasil Tes koneksi; saat template lama dibuka, pilihan tersimpan ditambahkan lebih dulu agar tetap terbaca sebelum tes dijalankan. `mediaVariable` menegakkan tata nama yang sama dengan placeholder, dan `templateInput` menolak penyimpanan bila sumber media endpoint dipilih tanpa menyebut variabelnya.

Bukti: 15/15 tes Auto Share lulus, regresi penuh 143/144 dengan satu kegagalan batas memori AI pra-eksisting, pemeriksaan browser lulus pada desktop dan ponsel, TypeScript check dan build lulus. Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

### Perbaikan UX form pengiriman/jadwal — 23 September 2026

Analisis menemukan tiga penolakan `jobInput` yang tidak memiliki penanda apa pun di form, sehingga baru terlihat setelah tombol simpan ditekan. `shareJobBlocker()` kini mencerminkan validasi tersebut di sisi klien dan menonaktifkan tombol simpan selama ada yang kurang; input waktu juga memakai atribut `min` agar waktu lampau tidak dapat dipilih sejak awal. Validasi server tidak diubah dan tetap menjadi penentu akhir.

`shareJobSummary()` menghitung tujuan unik dari gabungan kontak dan kelompok, termasuk jumlah nomor yang tumpang tindih. Backend memang mendeduplikasi pada `enqueue`, tetapi sebelumnya pengguna tidak punya cara mengetahui berapa penerima sebenarnya sebelum menyimpan.

Kontak tujuan berpindah dari `<select multiple>` ke daftar checkbox dengan pencarian. Kontrol lama mensyaratkan Ctrl/Cmd yang tidak ada di ponsel, dan tidak dapat disaring ketika kontak bertambah banyak. Kelompok tetap memakai multi-select karena jumlahnya sedikit.

Dua bug ditemukan oleh pemeriksaan browser, bukan oleh pembacaan kode: `<select>` wajib yang kosong memblokir submit dengan pesan bawaan peramban yang tidak menyebut penyebabnya. Terjadi pada pilihan asset saat galeri tidak memuat jenis media terkait, dan pada pilihan sesi saat akun belum punya sesi WhatsApp. Keduanya kini menampilkan keterangan pengganti, dan ketiadaan sesi juga muncul pada daftar "Lengkapi dulu".

Bukti: `scripts/browser-job-form-check.ts` lulus pada viewport 1280 px dan 390 px, mencakup daftar penghalang, pratinjau rotasi, pencarian kontak, perhitungan tumpang tindih, penolakan waktu lampau, serta simpan dan buka ulang yang memulihkan kontak, kelompok, dan urutan template. Regresi penuh 143/144 dengan satu kegagalan batas memori AI pra-eksisting. TypeScript check, build, dan sintaks JavaScript lulus. Pengiriman WhatsApp nyata belum diuji. Tidak ada commit/push/deploy.

### Rapikan otomatis pesan Auto Share dengan AI — 23 September 2026

Perapihan berjalan di `prefetchSource` tepat setelah `renderTemplate`, bukan saat template disimpan, karena template hanya memuat placeholder sementara kalimat sesungguhnya baru terbentuk setelah substitusi. Letaknya di luar transaksi seperti pengambilan data, sehingga panggilan AI tidak menahan kunci akun, dan tetap satu panggilan per pengiriman bukan per kontak.

`src/auto-share-tidy.ts` menelan seluruh kegagalan dengan sengaja: provider mati, kredit tidak cukup, atau hasil yang ditolak semuanya mengembalikan teks asli beserta alasannya, lalu pengiriman berjalan normal. Ini kebalikan dari kegagalan sumber data yang wajib membatalkan pengiriman karena datanya memang tidak ada. `acceptTidyResult` menolak hasil kosong, melebihi 10.000 karakter, atau menyusut di bawah 40% panjang asli sebagai tanda model meringkas alih-alih memformat ulang.

Kredit memakai pola reserve lalu settle seperti asisten: saldo dikunci `FOR UPDATE`, dipesan sebelum panggilan, dan selisihnya dikembalikan setelahnya. Baris `ai_usage` memakai agent `rapikan` agar pemakaian ini terpisah dari percakapan asisten. Prompt owner disimpan pada `ai_settings.tidy_prompt` dan kosong berarti `defaultTidyPrompt`.

Endpoint `test-source` mengembalikan pratinjau pesan akhir termasuk hasil perapihan. Tanpa itu pengguna menyalakan jadwal untuk keluaran yang tidak pernah dilihatnya, karena hasil perapihan tidak dapat diperiksa setelah terkirim.

Bukti: 17/17 tes Auto Share lulus, regresi penuh 145/146 dengan satu kegagalan batas memori AI pra-eksisting, dua pemeriksaan browser lulus pada desktop dan ponsel, TypeScript check dan build lulus. Migrasi dijalankan pada database pengembangan. Pengiriman WhatsApp nyata dan panggilan AI sungguhan belum diuji; pengujian memakai transport tiruan. Tidak ada commit/push/deploy.

### Cache busting aset front-end — 23 September 2026

`src/app.ts` membaca `public/index.html` dan `public/ai-studio.html` sekali saat startup, mengganti rujukan `app.js`, `style.css`, `ai-studio.js`, dan `ai-studio.css` dengan URL bertanda hash SHA-256 dari isi berkas, lalu menyimpan hasilnya di memori. Halaman tidak lagi dilayani `sendFile` melainkan dari salinan yang sudah ditulis ulang. Aset yang dimintai dengan parameter `v` dilayani `Cache-Control: public, max-age=31536000, immutable`; tanpa parameter itu perilakunya tidak berubah sehingga tautan lama tetap divalidasi ulang.

Pendekatan hash isi dipilih karena tidak memerlukan langkah build tambahan dan tidak berubah bila berkasnya tidak berubah, berbeda dengan penanda waktu mulai proses yang akan membatalkan cache pada setiap restart tanpa alasan.

Bukti: `test/assets.test.ts` memastikan hash pada halaman sama dengan hash isi berkas, tidak ada rujukan tanpa versi yang tersisa, dan aset berhash dilayani immutable sementara aset polos tidak. Regresi penuh 147/148 dengan satu kegagalan batas memori AI pra-eksisting.

### Catatan perapihan per template — 23 September 2026

Prompt pemilik layanan berlaku untuk seluruh akun, sedangkan tiap template memerlukan gaya berbeda. `auto_share_templates.tidy_note` menampung preferensi per template, digabung pada `tidyMessages`.

Penggabungan dilakukan sebagai giliran pesan terpisah, bukan penyambungan teks ke system prompt. Catatan ditulis staf akun dan sepenuhnya di luar kendali pemilik layanan, sehingga menyambungkannya ke aturan pemilik akan memungkinkan kalimat semacam "abaikan instruksi sebelumnya" membatalkan aturan seperti mempertahankan angka. Susunannya kini: system berisi aturan pemilik, user berisi catatan yang dibungkus pembatas beserta keterangan bahwa isinya preferensi gaya semata, system yang menyatakan ulang bahwa aturan di atas tetap berlaku penuh, lalu user berisi pesan yang akan dirapikan. Aturan pemilik dengan demikian menjadi instruksi terakhir yang dibaca model. Ini mengurangi, bukan menghilangkan, risiko prompt injection; dampak terburuknya tetap terbatas pada pesan milik akun itu sendiri.

Pratinjau memakai catatan yang sedang diketik pada formulir, bukan yang tersimpan, agar pengaruh perubahan terlihat sebelum template disimpan.

Bukti: 18/18 tes Auto Share lulus termasuk pemeriksaan susunan pesan, regresi penuh 148/149 dengan satu kegagalan batas memori AI pra-eksisting, pemeriksaan browser lulus pada desktop dan ponsel termasuk simpan lalu buka ulang. Migrasi dijalankan pada database pengembangan. Panggilan AI sungguhan belum diuji; pengujian memakai transport tiruan.

### Wizard template Auto Share — 24 September 2026

Dialog template kini memakai alur tiga tahap: Dasar untuk nama dan pilihan data, Konten untuk pesan/media/perapihan, lalu Tinjau untuk pratinjau dan simpan. Konfigurasi endpoint, header rahasia, dan tes koneksi tetap berada di tahap pertama agar editor pesan tidak penuh ketika memakai API. Navigasi memvalidasi hanya field pada tahap aktif, menampilkan progres dan ringkasan akhir, serta dirapatkan untuk layar ponsel. Pemeriksaan browser sumber data diperbarui untuk bergerak melalui wizard. TypeScript check dan build lulus; pemeriksaan browser perlu dijalankan lewat runner MySQL sementara yang biasa.

### Pembaruan Auto tambah — 24 September 2026

Listener hanya mengenali pesan keluar dari sesi sendiri. Perintah memakai pemisah hubung agar dua metadata dapat dibawa sekaligus: `tambah-nama-kelompok`, misalnya `tambah-budi-alyusro`; `tambah` tanpa nama maupun kelompok tetap valid. Pesan pribadi menyimpan lawan bicara, sedangkan pesan grup menyimpan ID grup. Nama dan kelompok dibatasi 100 karakter dan kontak yang sudah ada tidak ditimpa.

### Node Pesanan terstruktur — 24 September 2026

Agent Layanan kini memanggil `create_order` dengan satu baris teks berformat `2 x Produk; 1 x Produk lain; catatan: ...`, bukan JSON di dalam string. Server mengubahnya menjadi JSON dalam tiga lapis (`src/ai-order-schema.ts`):

1. Parser kode membaca format tersebut beserta variasinya (`2x`, `2 Produk`, `Produk x 2`, koma sebelum jumlah baru). Nama dicocokkan ke katalog tanpa membedakan huruf besar-kecil dan spasi, dan hanya diterima bila cocok ke tepat satu produk. Bila ada yang tidak pasti, parser mengembalikan null tanpa menebak.
2. Node workflow `pesanan` (tier default Murah, model dapat diganti di AI Studio) hanya dipanggil bila parser gagal. Mode default adalah prompt: schema dan daftar produk ditulis di instruksi, sehingga model tanpa dukungan JSON Schema tetap bisa dipakai. `structured_output` dapat dicentang untuk mengirim `response_format`; bila provider menolak dengan HTTP 400, node mencoba ulang dalam mode prompt. Jawaban diperbaiki secara deterministik (JSON di dalam teks atau code fence, jumlah berupa string angka, huruf besar-kecil nama, item identik ganda) sebelum divalidasi.
3. Kandidat nama produk berasal dari hasil `get_products` percakapan itu ditambah daftar katalog default, maksimal 100 nama. Katalog kosong, pesanan ambigu (`lengkap=false`), atau output di luar katalog dikembalikan ke Agent Layanan sebagai error 400 (`order_unavailable`, `order_unclear`, `order_invalid`) tanpa mutasi.

Workflow tersimpan yang belum memiliki node `pesanan` otomatis memakai default.

Bukti: regresi penuh 158/159 pada MySQL sementara dengan satu kegagalan batas memori AI pra-eksisting; `scripts/browser-ai-studio-check.ts` lulus setelah diperbarui (jumlah node dan tiruan agent `transaksi` di skrip itu sudah usang sebelum perubahan ini). Uji provider nyata: `inclusionai/ling-3.0-flash-fin:free` menolak `response_format` ("structured outputs not support"), sedangkan `nvidia/nemotron-3-super-120b-a12b:free` menerima schema pesanan. Mode prompt dengan model ling belum terverifikasi karena provider gratis membalas HTTP 429 berulang saat pengujian.

### Status pesanan dan info foto produk untuk AI — 24 September 2026

Status pesanan `baru` ditampilkan sebagai "Pesanan masuk" di dashboard; nilai tersimpan dan API tetap `baru`. Hasil `get_products` untuk AI (tool nyata dan sandbox AI Studio) kini memuat `ada_foto` yang diturunkan dari `image_id`, tanpa mengirim id internal; prompt `send_product_image` meminta agent hanya memakai produk dengan `ada_foto=true`. Tidak ada kolom database baru. Asersi jeda di `test/ai.test.ts` disesuaikan dengan jeda awal sebelum read (tes retry sempat gagal sejak perubahan urutan balasan). Bukti: regresi penuh 159/160 dengan satu kegagalan batas memori AI pra-eksisting; pemeriksaan browser AI Studio lulus.

### Aksi pesanan dan status Dibayar — 24 September 2026

Tabel Pesanan Masuk memakai tombol ikon edit dan hapus. Endpoint baru `DELETE /sessions/:id/ai/orders/:order` hanya menghapus pesanan milik akun dan sesi tersebut; stok tidak disesuaikan karena pesanan tidak pernah mengurangi stok. Status baru `dibayar` berada di antara `baru` dan `diproses`. Kolom `ai_orders.status` bertipe ENUM sehingga perlu `npm run migrate` (tidak berjalan otomatis saat server start); migrasi idempoten dan mempertahankan status yang sudah ada. Endpoint pesanan client juga boleh mengembalikan `dibayar`. Bukti: regresi penuh 161/162 dengan satu kegagalan batas memori AI pra-eksisting; pemeriksaan browser desktop dan ponsel untuk ikon, edit ke Dibayar, dan hapus lulus. Migrasi sudah dijalankan pada database pengembangan.

### Status pesanan disederhanakan — 24 September 2026

Status pesanan kini tepat lima, baik nilai tersimpan, API, maupun endpoint client: `pesanan_masuk`, `dibayar`, `diproses`, `selesai`, `dibatalkan` (menggantikan catatan sebelumnya yang masih memakai `baru`). Migrasi di `migrateAI` memperlebar ENUM, mengubah semua pesanan `baru` menjadi `pesanan_masuk`, lalu menghapus `baru`; idempoten dan wajib dijalankan dengan `npm run migrate` setelah deploy. Endpoint pesanan client yang masih mengirim `baru` ditolak. Hasil `check_order`/`create_order` untuk AI memakai label tampilan (misalnya "Pesanan masuk"), sedangkan API mengembalikan nilai mentah. Bukti: regresi penuh 161/162 dengan satu kegagalan batas memori AI pra-eksisting; pemeriksaan browser pesanan dan AI Studio lulus; migrasi dijalankan pada database pengembangan.

### Tier model Terstruktur — 24 September 2026

Tier keempat `structured` (label "Terstruktur") menampung model yang mendukung JSON Schema strict, karena tidak semua model bisa dan kebutuhannya hanya di beberapa node. Node Pesanan kini default di tier ini; Router tetap Murah tetapi bisa dipindah. Node yang punya schema (Router, Pesanan) otomatis mengirim `response_format` bila memakai tier Terstruktur atau bila `structured_output` dicentang (`schemaEnabled` di `src/ai-models.ts`); Pesanan tetap mencoba ulang dalam mode prompt bila provider menolak. Profil provider wajib mengisi Model Terstruktur dan rute wajib mencakup tier ini. Migrasi menambah kolom `model_structured` di `ai_settings` dan `ai_provider_profiles` (diisi dari model Murah) serta rute `structured` yang disalin dari rute Murah; jalankan `npm run migrate` setelah deploy. Workflow tersimpan yang sudah menyimpan node Pesanan mempertahankan tier yang tersimpan. Bukti: regresi penuh 163/164 dengan satu kegagalan batas memori AI pra-eksisting, termasuk tes baru profil/rute/runtime/migrasi tier; pemeriksaan browser halaman admin AI dan AI Studio lulus; migrasi dijalankan pada database pengembangan.

Audit tier Terstruktur: `config()` dan `providerProfiles()` kini memakai `SELECT *` sehingga routing dan daftar profil tetap berjalan bila kode baru aktif sebelum `npm run migrate`; rute atau model Terstruktur yang belum ada memakai Murah, dan kegagalan memuat rute dicatat ke log alih-alih diam-diam kembali ke konfigurasi lama untuk semua tier. AI Studio memperbaiki label node tier Terstruktur yang sebelumnya tampil "undefined", serta menampilkan centang Structured Outputs terkunci aktif di tier tersebut tanpa mengubah nilai tersimpan. `scripts/browser-template-source-check.ts` gagal (tombol variabel sumber data tidak muncul) juga pada commit sebelum tier ini, jadi bukan regresi dari perubahan ini.

### Tab Percakapan bergaya chat — 24 September 2026

Tab Percakapan di `/dashboard/ai` kini berupa tampilan chat (desain disetujui di kanvas Claude Design "Desain Percakapan NC-WA"): daftar percakapan dengan nama kontak, cuplikan dan waktu pesan terakhir, filter status dan pencarian; isi chat dengan gelembung pelanggan/AI/Manual/API/Sistem, centang terkirim-diterima-dibaca, catatan sistem, konteks S-P-O, kontrol Jeda/Lanjutkan, Full auto, Hapus konteks, Simpan ke kontak, serta kolom balasan manual. Ponsel memakai layar daftar dan layar chat terpisah.

Riwayat lengkap disimpan di tabel baru `ai_chat_messages` (`src/ai-chat.ts`), terpisah dari memori AI sehingga tidak ikut terhapus oleh Hapus konteks; hanya chat pribadi. Pesan masuk dicatat di `onIncoming`, setiap kiriman di `onSent` sebagai `api`, lalu AI/dashboard/relay tim menimpa asalnya (`ai`/`manual`/`system`) tanpa pernah diturunkan kembali; gema kiriman sistem dari HP tidak dicatat ganda, sedangkan balasan dari HP menjadi `manual`. Status centang berasal dari event Baileys `messages.update` yang diteruskan sebagai `receipt` dan hanya naik. Catatan sistem dicatat untuk jeda karena balasan manual, jeda/lanjut oleh admin, full auto, dan hapus konteks; id catatan berurutan waktu agar dua catatan di milidetik yang sama tetap urut. Endpoint baru: `GET /sessions/:id/ai/chats`, `GET /sessions/:id/ai/chats/:customer/messages?before=`, `POST /sessions/:id/ai/chats/:customer/messages` (Idempotency-Key wajib, 1 kredit, menjeda AI kecuali full auto). Stream `/events` mengirim `chat.updated`. Riwayat ikut terhapus saat sesi dihapus dan saat akun dihapus. Tabel dibuat oleh `npm run migrate`; riwayat baru mulai terisi sejak deploy.

Bukti: regresi penuh 166/167 dengan satu kegagalan batas memori AI pra-eksisting, termasuk tes baru `test/ai-chat.test.ts`; `scripts/browser-ai-conversation-check.ts` ditulis ulang dan lulus di desktop dan ponsel (termasuk pembaruan realtime dan balasan manual berkredit). Bagian simpan kontak di `scripts/browser-auto-share-check.ts` diperbarui dan lulus; skrip itu masih gagal pada langkah wizard template yang sudah usang sebelumnya.

Tes batas memori AI (`test/ai.test.ts`, "Memory holds individual messages…") diperbaiki: tes hanya memasang batas 3 di pengaturan tiruan, padahal memori tersimpan dipangkas memakai `ai_settings.memory_limit`. Tes kini memasang batas di `ai_settings` lalu mengembalikannya; kode aplikasi tidak berubah.

### Multi-profil AI — 25 September 2026

Rencana dan keputusan di [plane-multi-profil.md](plane-multi-profil.md); desain disetujui di kanvas Claude Design "Desain Multi-Profil NC-WA". **Profil** adalah pipeline yang disediakan sistem (node, tool, bentuk data, tab menu sesi) dan didaftarkan di `src/ai-profiles.ts`; baru ada `cs` (CS Usaha). **Data profil** (`ai_data_profiles`) adalah isi milik akun untuk satu profil: knowledge, perilaku, nomor fallback, produk, foto, sumber data, dan pesanan. Satu data profil bisa dipasang ke banyak sesi (`ai_assistants.data_profile_id`) dan tetap ada saat dicabut. Memori AI, riwayat chat, jeda, dan tiket fallback tetap per sesi. Mengganti atau mencabut data profil mengosongkan memori AI dan konteks S-P-O sesi itu serta mencatat catatan di riwayat chat.

Admin menyalakan/mematikan profil secara global (`ai_profile_types`, halaman `/dashboard/admin/profiles`); profil yang dimatikan menghentikan AI di semua sesi pemakainya tanpa menghapus data profil. `ai_workflow` kini satu baris per profil (`profile_type`); AI Studio memilih profil lewat `?profile=` dan draft/publish terpisah per profil. Runtime `process()` di `ai.ts` adalah pipeline CS dan hanya berjalan bila sesi memasang data profil CS yang profilnya aktif. `ai_usage` dan `ai_trace_log` mencatat `profile_type` (usage juga `data_profile_id`).

Migrasi (`migrateProfiles` di `src/ai-schema.ts`) membuat data profil `CS – <sesi>` untuk setiap sesi yang punya pengaturan atau data, memasangnya dengan status AI yang sama, memindahkan produk/sumber/foto/pesanan dari kunci sesi ke kunci data profil (pesanan menyimpan `session_id` asal), lalu menghapus kolom knowledge lama dari `ai_assistants`. Migrasi lama yang menambah kolom `profil_*`/`fallback_*` ke `ai_assistants` hanya berjalan pada skema lama. Endpoint per sesi yang lama tetap bekerja pada data profil terpasang; penulisan pada sesi tanpa profil membuat `CS – <sesi>` (atau `(2)`, dst.). Endpoint baru: `GET /ai/profile-types`, `GET/POST /ai/data-profiles` (termasuk `copy_from` untuk duplikat beserta salinan file foto), `GET/PATCH/DELETE /ai/data-profiles/:id`, `PATCH /ai/data-profiles/:id/field`, produk/foto/pesanan di bawah data profil, `PUT /sessions/:id/ai/profile`, serta admin `GET /api/admin/ai/profiles` dan `PUT /api/admin/ai/profiles/:profile`. `app.ts` meneruskan awalan `/ai/` ke gateway. Uji Coba bisa menjalankan data profil langsung (`{"data_profile":id}`), termasuk yang belum dipasang.

Dashboard klien: pengalih Sesi | Data Profil di halaman Asisten AI, profil pada kartu sesi, strip profil dengan Ganti/Cabut dan peringatan pemakaian bersama, dialog pasang dua langkah, daftar data profil (Kelola isi, Uji Coba, ganti nama, duplikat, hapus), tab sesi mengikuti profil. Ponsel: menu atas satu baris yang bisa digeser, sub-tab Knowledge menjadi dropdown, menu admin menjadi header dengan tombol menu (tidak lagi panel bawah yang menutupi konten), node AI Studio tampil sebagai daftar.

Bukti: migrasi dari skema commit `23634d3` dengan data contoh diuji pada MySQL sementara (dua kali jalan, termasuk hapus akun berantai); regresi penuh 174/174 termasuk `test/ai-profiles.test.ts` baru; `scripts/browser-ai-profiles-check.ts` baru lulus di desktop dan ponsel; `browser-ai-conversation-check`, `browser-ai-studio-check`, dan `browser-job-form-check` lulus. `browser-template-source-check` dan langkah wizard `browser-auto-share-check` masih gagal seperti sebelumnya. Wajib `npm run migrate` setelah deploy.


## CS Lembaga Pendidikan (profil kedua), 25 September 2026

Profil `pendidikan` untuk sekolah, pesantren, ma'had, kampus, dan kursus, sesuai kanvas "Desain Profil CS Lembaga Pendidikan". Profil ini hanya memberi informasi dan tidak menyimpan data pribadi siswa atau wali (tidak ada pencatatan pendaftar, booking, atau data siswa aktif). Rinciannya di `plane-multi-profil.md` bagian 6.

Pipeline kini dipilih per profil: `Pipeline` di `src/ai-agents.ts` (agent, prompt router/context, izin tool, tier default, protokol jawaban); `runAgents`/`updateRouterContext` menerima pipeline, enum router ikut daftar agent profil (`routerSchema(names)`), dan `defaultWorkflow`/`workflowInput` di `ai-workflow.ts` bekerja per pipeline. Perilaku dan prompt CS tidak berubah. `process()` di `ai.ts` menjalankan pipeline sesuai profil data profil yang terpasang; `defaultTools` mengarahkan tool ke penyimpan data profil pemiliknya.

Data: kolom `edu_*` di `ai_data_profiles` (FAQ memakai `profil_faq`, batas 4.000 untuk profil ini), tabel `ai_edu_programs`, `ai_edu_contacts`, `ai_edu_documents` (file di `<root>/_ai-documents/<akun>/`; ikut disalin saat duplikat, dihapus bersama data profil). Dokumen dicek dari isi file (PDF, Office termasuk .doc/.xls/.ppt lama, JPG/PNG/WebP), maks. 10 MB (gambar 5 MB), 20 dokumen dan 100 MB per data profil. `kirim_dokumen` mengirim file sebelum jawaban teks (maks. tiga per jawaban, tiap file satu kredit WhatsApp) dan mencatat `[Dokumen terkirim: nama]` di memori AI agar tidak terkirim ulang. Produk/pesanan dan `PUT /sessions/:id/ai` hanya menerima data profil CS (409 `profile_mismatch`). Riwayat chat kini mencatat nama file untuk kiriman dokumen tanpa caption. JSON hingga 64 KB diterima untuk `.../field` dan program (teks panjang).

Dashboard: tab Program, Jadwal, Dokumen, Kontak; sub-tab Knowledge mengikuti profil (Profil Lembaga dengan jenis lembaga dan sebutan); kartu data profil menghitung program/dokumen/kontak; dialog buat/pasang meminta jenis lembaga; Uji Coba menampilkan dokumen yang akan dikirim. AI Studio: tata letak kanvas dan data simulasi per profil. Profil baru muncul nonaktif sampai diaktifkan admin.

Bukti: regresi penuh 179/179 (termasuk `test/ai-edu.test.ts` baru, 5 tes); `scripts/browser-ai-edu-check.ts` baru lulus di desktop dan ponsel; `browser-ai-profiles-check`, `browser-ai-studio-check`, `browser-ai-conversation-check`, `browser-job-form-check` lulus. Saat menulis pemeriksaan ini ditemukan bahwa `page.waitForFunction` dengan fungsi async selalu langsung lulus; kedua skrip profil kini memakai polling `until()`. Migrasi dijalankan pada database pengembangan. Pengiriman dokumen ke HP WhatsApp nyata dan model AI sungguhan belum diuji. Wajib `npm run migrate` setelah deploy.


Sebutan dihapus (25 September 2026): isian Sebutan peserta didik/orang tua/pendidik dan kolom `edu_peserta`, `edu_wali`, `edu_pendidik` dihapus (migrasi menghapus kolomnya). Cara AI menyebut siswa, wali, dan pendidik sepenuhnya ditulis klien di Perilaku AI; prompt hanya menyebut jenis dan nama lembaga lalu merujuk ke Perilaku AI. Placeholder Perilaku AI pada profil pendidikan memberi contoh sebutan. Bukti: regresi 179/179, `browser-ai-edu-check` dan `browser-ai-profiles-check` lulus. Wajib `npm run migrate` setelah deploy.

Program, Jadwal, Dokumen, dan Kontak dipindah menjadi sub-tab Knowledge (urutan: Perilaku AI, Profil Lembaga, Program, Jadwal, Dokumen, Kontak, FAQ, Fallback Tim); menu atas profil pendidikan kini Knowledge, Percakapan, Riwayat pemakaian, Uji Coba, Integrasi (`tabs` profil: knowledge, usage, trial). Unggah dokumen memakai tombol, bukan form bersarang di dalam `#ai-form`. Di ponsel sub-tab dipilih dari dropdown Knowledge. Bukti: regresi penuh dan `browser-ai-edu-check`, `browser-ai-profiles-check`, `browser-ai-studio-check` lulus.

Jenis lembaga dihapus (25 September 2026): isian Jenis lembaga (Profil Lembaga, dialog buat/pasang, AI Studio), parameter `edu_kind`, dan kolomnya dihapus (migrasi men-drop `edu_kind`). Jenis dan identitas lembaga ditulis di teks Profil Lembaga; prompt menyebut "lembaga pendidikan" beserta nama data profil. Bukti: regresi 179/179, `browser-ai-edu-check`, `browser-ai-profiles-check`, `browser-ai-studio-check` lulus. Wajib `npm run migrate` setelah deploy.
