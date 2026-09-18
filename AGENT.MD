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

Asisten menandai pesan dibaca sebelum generasi, mengirim composing setelah jawaban siap, menunggu acak 1–3 detik, mengirim jawaban, lalu paused melalui finally. Read/presence best effort tanpa kredit tambahan; pemeriksaan pembatalan dipertahankan selama jeda. Check/build dan 13/13 tes AI lulus. Uji HP nyata belum dilakukan.

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
