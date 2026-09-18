# NC-WA SaaS — Catatan Kegagalan

Catat hal yang sudah dicoba dan terbukti gagal, bukan daftar tugas atau dugaan yang belum diuji.

Belum ada percobaan implementasi atau perbaikan SaaS. Catatan kegagalan di [proyek lama](../nc-wa/DEBUG.md) hanya referensi, bukan kejadian yang sudah direproduksi di sini.

## Format pencatatan

```text
## <Gejala yang diamati>
- Tanggal / tahap roadmap:
- Lingkungan / revisi:
- Cara reproduksi: <gunakan akun dan data tiruan>
- Hasil yang diharapkan:
- Hasil aktual:
- Coba 1: <tindakan> → <hasil dan bukti>
- Coba 2: <tindakan> → <hasil dan bukti>
- Terbukti bukan penyebabnya: <pemeriksaan yang sudah dilakukan>
- Status: belum selesai / selesai — <penyebab jika terbukti>
- Verifikasi perbaikan: <tes atau pengamatan; tulis belum diuji bila belum>
```

Simpan masalah yang sudah selesai agar pendekatan gagal tidak diulang. Jangan mencantumkan API key, password, auth state, QR, URL webhook rahasia, atau isi pesan pelanggan. Untuk masalah isolasi, gunakan label akun A/B dan ID tiruan.

## Penulisan tes restore memakai path relatif ganda
- Tanggal: 2026-09-15.
- Percobaan: menulis `nc-wa-saas/test/gateway.test.ts` saat direktori kerja sudah `nc-wa-saas`.
- Hasil: `No such file or directory`; tes tambahan tidak tertulis. Pemeriksaan saat itu hanya menjalankan 11 tes lama.
- Perbaikan: gunakan `test/gateway.test.ts`, lalu jalankan kembali seluruh pemeriksaan.

## Pemeriksaan tipe scheduler periode berbayar
- 2026-09-15: query SQL bertanda kutip tunggal bertabrakan dengan literal `'basic'`; `tsc` melaporkan TS1005 pada scheduler.ts:8.
- Perbaikan: gunakan template literal untuk query, lalu ulangi pemeriksaan.

## Tipe input pembayaran
- 2026-09-15: `tsc` menolak nilai `unknown` dalam parameter SQL dan properti hasil spread `RowDataPacket` (TS2769/TS2339).
- Perbaikan: simpan hasil validasi string dan bentuk objek kredensial dengan properti eksplisit; ulangi pemeriksaan tipe.

## Regresi tes restore setelah pembatasan paket dan deadlock inisialisasi wallet
- 2026-09-15: tes restore mengharapkan dua slot per akun, tetapi fixture masih paket dasar satu slot; session logout terbaru mengisi slot sehingga koneksi `shop` tidak dibuka.
- Perbaikan fixture: berikan dua slot eksplisit; uji batas satu slot dipisahkan.
- Pada suite yang sama MySQL melaporkan ER_LOCK_DEADLOCK pada inisialisasi wallet antarakun. Lock baris akun sudah dipakai, tetapi SELECT FOR UPDATE pada wallet yang belum ada mengambil gap lock dengan isolasi bawaan REPEATABLE READ.
- Perbaikan: gunakan READ COMMITTED pada koneksi pool, tetap pertahankan lock akun dan constraint unik. Verifikasi dengan suite transaksi bersamaan.

## Fixture SQL injection ditolak sebelum query
- 2026-09-15: tes mengharapkan 401, tetapi email injeksi mengandung spasi sehingga validator mengembalikan 400.
- Perbaikan tes: pertahankan assertion 400 untuk format email invalid dan tambahkan payload tanpa spasi agar query berparameter ikut diuji (401).

## Webhook persisten tidak terkirim pada tick pertama
- 2026-09-15: tes antrean mengharapkan satu panggilan transport, aktual nol; `next_at` memakai CURRENT_TIMESTAMP sesi MySQL lokal sementara worker membandingkan UTC_TIMESTAMP.
- Perbaikan: tetapkan `SET time_zone='+00:00'` untuk seluruh koneksi pool. Opsi mysql2 timezone sebelumnya hanya mengatur konversi driver, bukan zona waktu sesi SQL.

## Tipe ID rotasi key
- 2026-09-15: `tsc` TS2769 karena parameter opsional `replace` belum dipersempit walau baris key lama ditemukan.
- Perbaikan: gunakan `old.id` hasil query kepemilikan untuk DELETE.

## Kontrak Read n8n memakai `from`
- 2026-09-15: pengujian memanggil `NcWa.execute` dari paket n8n yang ada terhadap router SaaS. Send Text lulus, Read menerima 400 invalid_request.
- Penyebab: node mengirim `from`; implementasi SaaS awal membaca `to`.
- Perbaikan: rute Read menerima `from` sebagai field utama dan `to` sebagai alias. Proyek n8n tidak diubah.

## Pemeriksaan suite saat penambahan informasi tabel akun admin
- 2026-09-16: `npm test` menghasilkan 44/45 lulus.
- `test/session-limits.test.ts:13` mengharapkan penolakan `session_inactive`, tetapi `SessionManager.connected` mengembalikan `session_suspended`.
- Belum diubah karena di luar cakupan tabel akun admin. Pemeriksaan tipe, build, sintaks JavaScript, dan browser-check lulus.

## AI — 16 September 2026

Pemeriksaan tipe pertama menemukan TS2769 pada dua argumen SQL: narrowing boolean dari body tidak bertahan dalam callback transaksi. Nilai diubah menjadi boolean eksplisit setelah validasi tipe; tidak mengubah aturan validasi request.

Pemeriksaan tipe berikutnya menemukan TS2322 karena produk AI sintetis diberi tipe RowDataPacket. Snapshot produk kini memakai tipe field produk yang diperlukan pembayaran. Satu skrip edit lokal sempat menggunakan prefix direktori ganda dan berhenti dengan FileNotFoundError sebelum mengubah file; dijalankan ulang dengan path sesuai direktori kerja.

Review isolasi AI menemukan query pengambilan memori belum menyertakan predikat customer meskipun parameternya dikirim. Diperbaiki dengan predikat lengkap akun/session/customer. Fixture diubah memakai nomor pelanggan kedua yang urutan sort-nya lebih besar, agar kesalahan pemilihan baris pertama tidak bisa lolos karena baris baru berada di urutan pertama.

Pemeriksaan akhir pertama: suite 55/56 lulus. Tes batas body pembuatan API key gagal (mengharapkan 413, menerima 201) karena ukuran JSON diperbesar global untuk isian AI. Diperbaiki dengan parser 64 KiB hanya pada PUT pengaturan asisten per session; endpoint lain tetap 16 KiB. Browser AI timeout saat memeriksa isian sesudah reload: respons loadAssistant dapat menimpa ketikan baru. Isian kini dinonaktifkan selama pemuatan, dan respons lama diabaikan saat pilihan nomor berubah. Hanya tes terdampak diulang sesudah perbaikan.

## Multi-agent — 17 September 2026

Smoke test penyedia nyata pertama gagal dengan `ai_provider_failed` sebelum turn pertama selesai; seluruh tes lokal dan browser lulus. Transport lama menyamarkan status HTTP sehingga penyebab belum teridentifikasi. Tambahkan klasifikasi error tanpa body/kredensial sebelum menguji ulang.

Setelah klasifikasi error ditambahkan, smoke test menunjukkan `ai_provider_http_401`. Kredensial tersimpan ditolak endpoint. Tidak ada perubahan kredensial atau retry lanjutan; uji penyedia perlu API key valid. Tidak ada isi respons penyedia atau secret dicatat. Pengujian engine dengan transport tiruan dan browser tetap lulus.

## Tabel produk/order dan endpoint — 17 September 2026

Pemeriksaan tipe awal menemukan `unknown` dari JSON diteruskan ke parameter SQL dalam callback dan spread `RowDataPacket` tidak memberikan bentuk respons assistant yang pasti. Diperbaiki dengan normalisasi boolean/string dan pemetaan field respons eksplisit; check berikutnya lulus. Tidak ada perubahan kredensial provider. Tes terarah 36/36 dan browser desktop/mobile lulus setelah penambahan tabel, endpoint, serta alur order persisten.

## Auto Share — 18 September 2026

Tes awal menemukan `completed_with_errors` lebih panjang daripada kolom status 20 karakter; diperbaiki menjadi 32 karakter dengan migrasi idempoten. Tes pemulihan terarah kemudian lulus. Browser menemukan dialog simpan kontak tidak terlihat dari halaman AI karena berada di dalam section Auto Share yang hidden; dialog dipindahkan ke luar section. Proses dev aktif juga menjalankan scheduler pada database lokal, sehingga verifikasi antrean berikutnya memakai MySQL sementara terisolasi agar tidak bersaing dengan worker aplikasi.

Suite penuh pertama pada database terisolasi: 117/118 lulus; tes memori AI gagal pada batas global yang juga diubah suite AI lain secara paralel. Runner terisolasi diubah menjalankan file tes secara serial (`--test-concurrency=1`), tanpa mengubah implementasi AI atau ekspektasi tes tersebut.

Eksekusi serial tetap menghasilkan kegagalan tes memori AI yang sama (118/119 lulus); dugaan persaingan antarsuite tidak menjelaskan kegagalan. Tes memakai config tiruan `memory_limit=3`, sementara penulisan balasan membaca ai_settings/default database. Tidak mengubah perilaku AI dalam pekerjaan Auto Share. Tes Auto Share 5/5 lulus. Browser kemudian menemukan tab Auto Share tidak membungkus di viewport 390 px; ditambahkan flex-wrap untuk baris tab.
