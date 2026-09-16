# NC-WA SaaS — Spesifikasi Awal

Status: spesifikasi target; fondasi akun/dashboard mulai diimplementasikan. Status fitur dan bukti verifikasi ada di ROADMAP.MD. Bagian usulan dan keputusan terbuka belum menjadi keputusan final pemilik.

## 1. Arah produk dari diskusi

- Versi NC-WA untuk banyak akun, dikembangkan di folder terpisah.
- Setiap akun mempunyai API key sendiri.
- Client memakai satu Base URL dan endpoint yang sama; backend membatasi akses berdasarkan akun pemilik API key.
- Tidak memerlukan pembuatan server atau subdomain untuk setiap pendaftaran.
- Menambahkan halaman manajemen pengguna dan admin, beserta backend akun, kepemilikan data, dan layanan berbayar.
- Satuan pemakaian: 1 kredit untuk 1 pesan keluar yang diterima WhatsApp untuk dikirim. Model layanan adalah paket bulanan dengan batas kredit, termasuk paket dasar gratis.
- Pembayaran menggunakan QRIS Midtrans Core API, dengan QR ditampilkan langsung di dashboard NC-WA.
- Pengaturan kredensial Midtrans khusus pemilik layanan sebagai super admin.

Contoh alamat dari diskusi: `https://nc-wa.nuscode.id`. Ini contoh target, bukan bukti domain sudah dikonfigurasi. Dashboard bersama: `/dashboard`, dengan menu dan data mengikuti peran akun yang login.

## 2. Cakupan gateway

Kemampuan berikut mengacu pada [spesifikasi NC-WA](../nc-wa/SPEC.md) dan ditargetkan tersedia setelah diadaptasi serta diuji:

- Multi-session WhatsApp: QR, status, reconnect, logout, hapus, dan filter pesan.
- Kirim teks/media ke pribadi atau grup, antrean dan jeda pengiriman.
- Pesan masuk, media masuk, webhook pesan/status/QR, serta pendaftaran webhook lewat API.
- Tandai dibaca, indikator mengetik, statistik, dan event realtime.
- Integrasi paket [n8n-nc-wa](../n8n-nc-wa/README.md).

Broadcast, penjadwalan, manajemen kontak, workspace tim, dan provisioning server otomatis belum masuk cakupan awal.

## 3. Akun dan hak akses

Usulan MVP: satu akun pengguna menjadi satu pemilik layanan (tenant). Tim dengan banyak anggota belum diperlukan.

| Peran | Akses yang direncanakan |
| --- | --- |
| Pengguna | Session, API key, media, webhook, pemakaian, dan pembayaran miliknya |
| Pemilik / super admin | Pengelolaan akun, paket, status layanan, pembayaran, kesehatan sistem, dan kredensial Midtrans |

Login dashboard terpisah dari autentikasi API client. Usulan login memakai sesi browser dengan cookie HttpOnly, Secure, perlindungan CSRF untuk perubahan data, password yang di-hash, dan pembatasan percobaan login. Pendaftaran terbuka melalui `/register`; akun baru mendapat paket dasar gratis. Lupa password ditangani dengan menghubungi admin; tidak tersedia pemulihan akun mandiri.

Untuk awal hanya ada pengguna dan pemilik/super admin; sebutan admin atau pengelola pada dokumen ini merujuk pemilik. Tidak perlu peran manajer tambahan. Pendaftaran pelanggan tidak boleh membuat akun pemilik.

API key pengguna tidak memberikan akses admin. Perubahan admin yang memengaruhi akun atau tagihan harus tercatat dalam audit. Dashboard admin tidak otomatis menampilkan isi percakapan pelanggan.

## 4. API key dan isolasi data

- Header client tetap `X-API-Key`. Key acak, sulit ditebak, disimpan sebagai hash, ditampilkan utuh saat pembuatan, dan dapat dicabut/diganti.
- Setiap akun memiliki key sendiri; jumlah key aktif dan mekanisme rotasi ditentukan saat desain rinci.
- Server menentukan akun dari kredensial terverifikasi. Field `accountId` dari request tidak boleh mengganti identitas tersebut.
- Semua query, perubahan, antrean, auth state, media, statistik, event realtime, dan webhook harus dibatasi pemilik.
- Usulan ID session unik di dalam akun: A dan B dapat memiliki `toko`. Identitas internal menggunakan pasangan akun + session; path disk tidak dibentuk langsung dari input pengguna.
- Akses ID milik akun lain menghasilkan respons tidak ditemukan yang tidak membocorkan keberadaan data tersebut.
- API key tidak dimasukkan ke URL. Event realtime menggunakan header melalui streaming fetch atau sesi dashboard yang terverifikasi.
- HTTPS diperlukan pada akses publik. Pencabutan key harus menghentikan akses baru serta menutup aliran realtime yang memakai key tersebut.

## 5. Halaman manajemen

### Satu dashboard berdasarkan peran

- Pemilik dan pelanggan memakai halaman login `/login` dan dashboard `/dashboard` yang sama.
- Menu pemilik menampilkan pengelolaan layanan; menu pelanggan menampilkan layanan miliknya. Tidak diperlukan halaman dashboard terpisah berprefix `/admin`.
- Backend memeriksa peran serta kepemilikan pada setiap request. Menyembunyikan menu tidak menggantikan pemeriksaan akses; pelanggan yang memanggil API pengelolaan langsung tetap ditolak.
- Endpoint pengelolaan dapat dikelompokkan di `/api/admin/...` untuk memudahkan pemeliharaan. Ini usulan pengelompokan API, bukan mekanisme keamanan atau alamat dashboard terpisah.

### Menu pengguna

- Login/logout serta profil akun.
- Daftar nomor, tambah session, scan QR, status, reconnect, logout/hapus, dan filter.
- Kelola API key, petunjuk Base URL, dan konfigurasi n8n.
- Kelola webhook dan lihat status layanan/pemakaian milik sendiri.
- Lihat paket, saldo/kuota, masa aktif, serta riwayat pembayaran sesuai model bisnis terpilih.

### Menu pemilik / super admin

- Daftar akun, status aktif/suspend, batas nomor, dan penggunaan.
- Kelola harga paket, kredit yang diberikan, batas nomor, serta pantau pembayaran yang diverifikasi otomatis melalui Midtrans.
- Menu Pengaturan → Payment Gateway → Midtrans hanya untuk pemilik layanan (lihat bagian 6).
- Penyesuaian kredit/kuota dengan alasan dan catatan audit.
- Pantau session aktif, antrean, kegagalan engine/webhook, dan kapasitas server.

### Paket & Harga

Satu halaman dalam dashboard pemilik untuk membuat dan mengubah paket:

- Nama paket, harga rupiah, jumlah kredit, dan batas nomor WhatsApp aktif.
- Masa aktif bila paket memakai langganan, serta status aktif/nonaktif untuk menentukan ketersediaan pembelian.
- Harga default menjadi data awal yang dapat diedit dari dashboard tanpa mengubah kode. Default paket dasar: gratis, 1 nomor, 100 kredit per bulan. Harga dan manfaat paket berbayar ditentukan pemilik lewat dashboard.
- Jika tambahan kredit dipilih, kelola melalui tab Tambahan Kredit pada halaman yang sama.
- Pelanggan melihat paket aktif melalui menu Beli Paket. Backend memvalidasi paket dan menghitung harga dari katalog server saat membuat order.
- Perubahan harga/manfaat berlaku untuk transaksi baru. Order yang sudah dibuat mempertahankan snapshot harga dan manfaat saat pembelian; perubahan katalog tidak mengubahnya.
- Paket nonaktif tidak ditawarkan untuk pembelian baru; riwayat dan transaksi yang sudah dibuat tetap tersimpan.

### Landing page

Landing page sederhana di `/` menjadi bagian rencana peluncuran publik, dikerjakan setelah fungsi inti tersedia. Isinya penjelasan layanan, fitur dan integrasi n8n, paket/harga, cara mulai, tombol masuk/daftar, serta kontak bantuan.

Harga, kredit, dan batas nomor mengambil katalog paket aktif yang sama dengan menu Paket & Harga dan Beli Paket. Data publik hanya berisi informasi penawaran, tanpa data pelanggan atau konfigurasi rahasia. Tombol daftar menuju `/register`; pendaftaran mandiri terbuka.

## 6. Kredit, langganan, dan pembayaran

Model yang dipilih: langganan bulanan dengan batas kredit.

### Paket dasar dan periode berbayar

- Default paket dasar gratis: 1 nomor WhatsApp dan 100 kredit. Pemilik dapat mengubah jumlah kredit dan batas nomor di Paket & Harga.
- Akun baru langsung mendapat kuota gratis sesuai konfigurasi paket dasar terbaru (default 100 kredit). Kredit dasar direset menjadi kuota yang berlaku setiap tanggal 1 pukul 00.00 WIB (`Asia/Jakarta`), bukan ditambahkan. Sisa kredit hangus.
- Usulan penerapan perubahan kredit dasar untuk akun berjalan: saat reset berikutnya; aturan perubahan batas nomor masih perlu dirinci.
- Paket berbayar mulai saat pembayaran terkonfirmasi dan berlaku satu bulan. Kredit paket kedaluwarsa jika periode berakhir tanpa pembelian baru. Pembelian saat paket masih aktif mengikuti aturan penggabungan kredit di bawah.
- Paket berbayar berakhir → akun kembali ke paket dasar gratis. Nomor terakhir yang dibuat tetap aktif; sisanya berstatus nonaktif dan tidak dihapus. Jika batas dasar dikonfigurasi lebih dari satu, usulan teknisnya memilih sejumlah nomor terbaru sesuai batas. Pemberian kredit dasar saat kembali di tengah bulan masih perlu dirinci; pemberian 100 kredit saat registrasi bukan keputusan tentang kuota saat downgrade.
- Jika membeli paket baru saat paket berbayar lama masih aktif: paket baru langsung aktif setelah pembayaran terkonfirmasi. Saldo menjadi sisa kredit lama yang masih berlaku ditambah kredit paket baru; masa aktif menjadi satu bulan sejak pembayaran baru, dan batas nomor mengikuti paket baru. Penggabungan kredit/pergantian periode dilakukan atomik dan sekali per pembayaran.
- Jika tidak membeli lagi hingga periode habis, sisa kredit hangus dan akun kembali ke paket dasar. Kredit yang sudah kedaluwarsa tidak dihidupkan kembali oleh pembelian setelah expiry.
- Harga, kredit, batas nomor, dan masa aktif paket berbayar yang sedang berjalan mengikuti snapshot pembelian. Perubahan katalog hanya berlaku pada pembelian/perpanjangan baru.
- Order pending mempertahankan snapshot harga/manfaat sampai order kedaluwarsa. Perubahan katalog tidak mengubah hak paket yang sudah dibayar.
- Pembayaran/perpanjangan dilakukan pengguna melalui QRIS; tidak ada autodebit dalam cakupan ini.
- Biaya pembayaran ditanggung pengguna dan ditambahkan ke total checkout/topup. Tampilkan harga dasar, biaya, dan total sebelum pembayaran; simpan perhitungan pada order. Tarif/pembulatan dan ketentuan penerapan biaya perlu diverifikasi sebelum produksi, tanpa mengasumsikan persentase tertentu.

### Aturan kredit dari diskusi

- 1 kredit = 1 pesan keluar yang berhasil diterima WhatsApp untuk dikirim, bukan menunggu sampai atau dibaca di HP penerima.
- Satu teks atau satu media beserta caption dihitung 1 kredit. Pesan masuk tidak memotong kredit.
- Pengiriman pasti gagal membatalkan reservasi/mengembalikan kredit.
- Timeout dengan hasil belum jelas menahan reservasi sampai rekonsiliasi; batas waktu dan penyelesaian kasus yang tidak dapat dipastikan perlu dirinci.
- Kredit mengikuti periode paket di atas. Harga dan kuota paket berbayar dapat dikonfigurasi pemilik.

Detail tersisa ada pada bagian 10. Usulan ketika kredit habis sebelum periode berakhir: hentikan pengiriman hingga periode baru atau pembelian yang diizinkan; jangan otomatis memberi kuota gratis tambahan. Penjualan tambahan kredit terpisah belum diputuskan.

Persyaratan teknis:

- Catatan penggunaan/tagihan persisten; statistik memori bukan sumber saldo.
- Pemotongan atau reservasi atomik agar request bersamaan tidak membelanjakan saldo/kuota yang sama.
- Pengiriman memiliki identitas permintaan yang dibatasi akun. Retry permintaan yang sama tidak boleh menyebabkan pemotongan ulang.
- Kegagalan pasti melepas reservasi. Timeout setelah pengiriman mungkin menghasilkan status tidak diketahui; jangan otomatis mengirim ulang atau refund tanpa penanganan hasil yang tidak pasti.
- Finalisasi pemotongan saat engine mengonfirmasi pesan diterima WhatsApp untuk dikirim.
- Pembayaran otomatis: verifikasi sumber, nominal, mata uang, identitas transaksi, dan status pembayaran di server; callback berulang tidak menggandakan kredit atau masa aktif. Tampilan browser bukan bukti pembayaran.

Jaminan pengiriman tepat sekali ke WhatsApp tidak boleh diasumsikan hanya dari idempotensi database. Desain harus menangani crash setelah engine mengirim tetapi sebelum hasil tersimpan.

### QRIS Midtrans Core API

Alur yang dipilih:

1. Pengguna memilih paket atau pembelian kredit yang tersedia. Backend menghitung harga dan menyimpan snapshot nominal, manfaat pembelian, akun pemilik, lingkungan, serta referensi versi kredensial.
2. Backend membuat order unik dan transaksi QRIS melalui Core API; Server Key tidak dikirim ke browser.
3. Dashboard menampilkan QR, nominal, status, dan masa berlaku dari data transaksi. Tidak memakai halaman Snap.
4. Lanjutkan pembayaran membaca transaksi tersimpan; refresh halaman tidak membuat charge baru. Hasil create yang timeout harus direkonsiliasi sebelum mencoba transaksi baru.
5. Backend memverifikasi signature notifikasi, mengambil status langsung ke Midtrans, lalu mencocokkannya dengan order tersimpan. Endpoint notifikasi Midtrans terpisah dari webhook pesan WhatsApp pelanggan.
6. Pembayaran terkonfirmasi mengaktifkan manfaat pembelian dalam transaksi database, sekali per order. Penguncian/constraint mencegah notifikasi atau pengecekan status bersamaan menggandakan kredit/periode.
7. Pengecekan status dapat memulihkan notifikasi yang terlambat/hilang. Status pending, gagal, batal, dan kedaluwarsa ditampilkan tanpa memberikan manfaat sebelum pembayaran terverifikasi.

Pembayaran terverifikasi menjadi awal periode paket berbayar. Pembelian saat paket berbayar masih aktif menggabungkan sisa kredit dan memulai periode baru sesuai aturan di atas. Tanggal akhir untuk pembelian pada tanggal 29–31 harus dirinci sebelum implementasi periode.

### Pengaturan Midtrans khusus pemilik

- Hanya akun pemilik/super admin dapat membaca status konfigurasi, menyimpan/mengganti kredensial, menguji koneksi, dan memilih lingkungan Sandbox/Production. Pembatasan wajib di backend.
- Server Key disimpan terenkripsi di backend; Client Key hanya ditambahkan bila diperlukan integrasi. Nilai rahasia ditampilkan tersamarkan dan tidak dikembalikan utuh lewat API pengaturan.
- Kunci enkripsi disimpan terpisah dari database dan tidak berada di repository. Log/audit tidak memuat nilai kredensial.
- UI menampilkan status konfigurasi serta URL notifikasi pembayaran untuk pengaturan merchant. Uji koneksi tidak membuat tagihan nyata.
- Setiap perubahan mencatat pelaku, waktu, dan metadata perubahan tanpa rahasia. Kredensial ini milik layanan NC-WA, berbeda dari API key NC-WA pelanggan.
- Simpan referensi versi kredensial dan lingkungan pada order. Pergantian konfigurasi tidak boleh membuat transaksi pending diverifikasi dengan lingkungan atau merchant yang salah. Rincikan penanganan rotasi/revokasi agar transaksi lama tetap bisa direkonsiliasi; jangan mengasumsikan key lama selalu berlaku.

### Referensi implementasi Wazna

Referensi lokal: `../../wazna/wazna_al_yusro_online_gateway/laravel_wazna_al_yusro_online_gateway/`. Pelajari `app/Services/MidtransService.php`, `TopupPaymentService.php`, `MidtransNotificationRouter.php`, serta controller dan tes webhook terkait.

Adaptasi pola verifikasi server-to-server, penyimpanan transaksi, konfigurasi kredensial, dan pencegahan saldo ganda. Jalur QRIS Snap sementara di Wazna tidak menjadi pilihan SaaS. Jangan menyalin rahasia atau mengubah proyek Wazna. Sebelum implementasi, verifikasi kontrak Core API terhadap dokumentasi resmi terbaru dan uji akun merchant; pembacaan kode Wazna bukan bukti kesiapan Core API produksi SaaS.

## 7. API dan kompatibilitas n8n

Gunakan community node `n8n-nodes-nc-wa` yang sudah ada; tidak membuat paket node khusus SaaS. Pengguna cukup mengganti Base URL dan API key. Target: mempertahankan rute dan bentuk payload gateway yang digunakan paket n8n. Perubahan node hanya dipertimbangkan jika pengujian membuktikan ketidakcocokan. Jangan mewajibkan field/header baru untuk penggunaan normal node lama; idempotensi harus dirancang dengan mengakui bahwa retry tanpa ID stabil tidak dapat dijamin bebas duplikasi. Semua rute berikut masih rencana pada SaaS.

| Metode / rute | Perilaku SaaS |
| --- | --- |
| `GET /sessions`, `POST /sessions` | Daftar/buat session akun pemanggil, dengan batas paket |
| `GET /sessions/:id`, `GET /sessions/:id/qr` | Detail/QR session milik pemanggil |
| `POST /sessions/:id/logout`, `POST /sessions/:id/reconnect` | Operasi hanya pada session milik pemanggil |
| `DELETE /sessions/:id`, `PUT /sessions/:id/filter` | Hapus/ubah filter milik pemanggil |
| `POST /sessions/:id/messages/text` | Kirim teks setelah memeriksa akses dan hak pemakaian |
| `POST /sessions/:id/messages/media` | Kirim media dengan pemeriksaan yang sama |
| `POST /sessions/:id/read`, `POST /sessions/:id/typing` | Presence session milik pemanggil |
| `GET /media/:id` | Unduh media setelah memeriksa kepemilikan |
| `GET /stats`, `GET /events` | Statistik/event akun pemanggil saja |
| `GET /webhooks`, `POST /webhooks`, `DELETE /webhooks/:id` | Kelola langganan webhook milik pemanggil |

Contoh konfigurasi client:

```text
Base URL: https://nc-wa.nuscode.id
X-API-Key: <key akun sendiri>
POST /sessions/toko/messages/text
```

Target format error tetap `{ "error": "kode", "message": "penjelasan" }`. Key tidak valid → 401, data tidak ada/tidak dimiliki → 404, input tidak valid → 400. Kode untuk batas paket, saldo, suspend, dan idempotensi ditetapkan dalam kontrak rinci sebelum implementasi billing.

Halaman login `/login` dan dashboard `/dashboard` digunakan bersama. Detail endpoint API akun, pengelolaan, paket, dan pembayaran belum ditetapkan. Dukungan ID permintaan pengiriman perlu diselaraskan dengan node n8n; kompatibilitas belum dinyatakan lulus.

## 8. Webhook, media, dan realtime

- Langganan tanpa `sessionId` menerima semua session milik akun tersebut saja.
- `sessionId` pada pendaftaran webhook harus milik akun pemanggil.
- Deduplicasi langganan dibatasi akun dan mempertimbangkan URL serta filter session. Menghapus langganan B tidak boleh dilakukan key A.
- Jangan menyalin broadcast webhook global `.env` proyek lama yang meneruskan seluruh event pelanggan ke satu URL.
- Retry webhook harus mempertahankan identitas akun/session; pengiriman ulang berhenti jika langganan dicabut.
- URL media keluar dan webhook divalidasi untuk mencegah akses jaringan internal, termasuk redirect dan perubahan DNS.
- Event realtime disaring sebelum dikirim, bukan hanya disembunyikan di UI.
- Retensi media dan batas penyimpanan ditentukan per kebijakan layanan; file harus terpisah berdasarkan pemilik internal.

## 9. Data dan operasi — usulan

Entitas awal: akun, sesi login, API key, session WhatsApp, langganan webhook, metadata media, penggunaan, serta audit admin. Tambahkan paket/periode langganan, pembayaran, ledger kredit, dan reservasi sesuai model bisnis yang dipilih.

Setiap data pelanggan memiliki relasi pemilik. Definisikan constraint database untuk mencegah benturan session dan transaksi duplikat. Simpan auth WhatsApp secara persisten dan terpisah antarakun; format penyimpanan akan dievaluasi saat desain.

TypeScript, Express, dan Baileys pada proyek lama menjadi titik awal evaluasi. Database dipilih MySQL dengan tabel transaksional InnoDB, query berparameter, migrasi, constraint unik, serta penguncian saat mutasi kredit/pembayaran. Gunakan database dan akun aplikasi lokal khusus, bukan root pada runtime. Versi server lokal terkonfirmasi 8.0.45. Fondasi memakai mysql2 dan HTML/CSS/JS dengan Express; antrean persisten serta target produksi belum dipilih. Penyedia pembayaran sudah dipilih: QRIS Midtrans Core API.

Satu aplikasi/domain dapat menjadi awal, dengan kapasitas dibuktikan melalui pengukuran jumlah session aktif. Satu session hanya boleh dibuka satu worker aktif. Backup/pemulihan harus mencakup database dan auth state secara konsisten. Terapkan batas request, antrean, dan penyimpanan per akun agar satu pelanggan tidak menghabiskan seluruh kapasitas.

Log mencatat kejadian sistem, ID internal, dan audit perubahan penting; jangan mencatat key, password, auth state, QR mentah, atau isi pesan.

## 10. Detail yang diselesaikan sebelum fitur terkait diimplementasikan

Arah produk sudah cukup untuk memulai fondasi. Hal berikut belum merupakan keputusan final:

1. Retensi nomor nonaktif, penanganan pembelian paket baru dengan batas nomor lebih rendah, serta penerapan perubahan batas nomor dasar. Aturan downgrade ke dasar 1 nomor sudah ditentukan: nomor terakhir dibuat tetap aktif.
2. Kuota saat kembali ke paket dasar di tengah bulan dan pencegahan pemberian kuota gratis berulang; perilaku kredit habis sebelum akhir periode.
3. Penanganan tanggal 29–31, sisa kredit gratis ketika pertama membeli paket berbayar, dan apakah tambahan kredit dijual terpisah. Pembelian saat paket berbayar aktif sudah ditentukan: gabungkan sisa kredit, masa aktif/batas nomor mengikuti paket baru.
4. Batas rekonsiliasi timeout dan refund pembayaran; tarif/pembulatan biaya checkout serta kesiapan merchant Core API.
5. Harga/manfaat paket berbayar diisi pemilik melalui dashboard; jangan mengarang harga produksi.
6. Framework dashboard, library MySQL, penyimpanan auth, antrean, kapasitas, retensi, dan target deploy dapat dirancang saat implementasi.

## 11. Persyaratan keamanan dan serangan umum

Ini persyaratan desain/pengujian, bukan daftar celah yang sudah ditemukan. DEBUG.MD hanya mencatat kegagalan yang terbukti.

| Ancaman | Persyaratan |
| --- | --- |
| IDOR / akses silang akun | Periksa kepemilikan pada setiap query, operasi, QR, media, webhook, statistik, dan transaksi |
| Eskalasi hak akses | Identitas/peran dari server; tolak perubahan peran lewat input registrasi/profil; semua API pemilik memerlukan peran pemilik |
| SQL injection | Query berparameter, validasi input, dan akun MySQL dengan hak terbatas |
| XSS | Escape output, render isi pesan/nama sebagai teks, hindari HTML mentah dari input, serta kebijakan CSP yang sesuai |
| CSRF | Token/pemeriksaan origin untuk mutasi berbasis cookie; cookie Secure, HttpOnly, SameSite; notifikasi Midtrans memakai autentikasi signature sendiri |
| Brute force dan penyalahgunaan registrasi | Rate limit login, registrasi serta API; key acak kuat, hash password/key, pencabutan kredensial |
| SSRF dan path traversal | Tolak tujuan jaringan internal termasuk redirect/DNS berubah; path media/auth memakai ID internal terkontrol |
| Pemalsuan/replay pembayaran | Signature + pemeriksaan status server, cocokkan order/nominal/mata uang, manfaat sekali per order |
| Race condition kredit/reset | Transaksi, lock, constraint unik per akun/periode; reset dan expiry aman diulang setelah restart |
| Kehabisan sumber daya | Batas request, ukuran media, session, antrean, dan penyimpanan per akun |
| Kebocoran rahasia | Enkripsi kredensial Midtrans, hash key/password, jangan expose lewat API/log, lindungi backup dan auth state |

Pelaksanaan dan bukti pengujian dicatat di [ROADMAP.MD](ROADMAP.MD).
