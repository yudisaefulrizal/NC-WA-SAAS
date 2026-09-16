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
