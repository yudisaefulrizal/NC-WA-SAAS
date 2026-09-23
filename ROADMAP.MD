# Roadmap NC-WA SaaS

Centang = implementasi tersedia; verifikasi akhir dan uji integrasi nyata masih tertunda (lihat [HANDOFF.MD](HANDOFF.MD)).

- [x] Registrasi dan login
- [x] Peran dan hak akses
- [x] API key per akun
- [x] Dashboard pengguna dan pemilik
- [x] Katalog Paket & Harga
- [x] Kredit dan batas pemakaian
- [x] Reset kredit bulanan
- [x] Aktivasi, perpanjangan, dan downgrade paket
- [x] Session WhatsApp dan pairing QR
- [x] Reconnect dan pemulihan session
- [x] Pengiriman teks dan media berkredit
- [x] Grup, read, dan typing
- [x] Antrean pesan
- [x] Webhook dan event realtime
- [x] Integrasi n8n
- [x] Pembayaran QRIS Midtrans
- [x] Pengaturan Midtrans
- [x] Riwayat pemakaian dan pembayaran
- [x] Tabel pembayaran admin menampilkan email akun
- [x] Manajemen akun dan penyesuaian kredit
- [x] Tabel akun admin: paket aktif dan sisa kredit
- [x] Audit dan pemantauan layanan
- [x] Tabel audit admin menampilkan email akun
- [x] Isolasi data dan keamanan
- [x] Landing page
- [x] Backup dan restore
- [ ] Deployment produksi

## Rencana pengembangan berikutnya

- [x] Asisten AI per nomor, pengetahuan/perilaku, kredit berbasis kata, memori global, dan integrasi SumoPod.
- [x] Menu Pengaturan AI pemilik, tes koneksi, API key terenkripsi.
- [x] Saldo/riwayat AI terpisah, pembelian QRIS per 1.000 kredit tanpa kedaluwarsa, penyesuaian saldo beraudit.
- [x] Jeda/hapus konteks pelanggan, deduplikasi, reservasi saldo, dan pemulihan restart.
- [ ] Uji AI dengan HP WhatsApp dan QRIS merchant nyata.

Aturan dan batas versi pertama: [plane-fitur-ai.md bagian 10](plane-fitur-ai.md#10-implementasi--16-september-2026).

- [x] Balasan AI natural: read sebelum generasi, composing → jeda acak 1–3 detik → kirim → paused; 13/13 tes AI dan check/build lulus.
- [x] Ambil alih otomatis dari balasan manual HP/Web: ID sistem disimpan sebelum pengiriman, pause per pelanggan, memori admin, deduplikasi persisten, dan pembatalan AI tertunda. Uji perangkat nyata masih tertunda.

## Multi-agent internal — 17 September 2026

- [x] Router delapan kategori dan spesialis mengikuti workflow JSON, tanpa n8n.
- [x] Shared memory MySQL per tenant/session/pelanggan, adapter empat tools, mode demo eksplisit, dan riwayat agent.
- [x] Migrasi additive serta UI konfigurasi; tes terarah 26/26 dan browser desktop/mobile lulus.
- [ ] Uji penyedia multi-agent nyata: terhalang HTTP 401, perlu API key valid.
- [ ] Uji multi-agent dari HP WhatsApp nyata.

Detail arsitektur, integrasi tools nyata, dan pengujian: [AI-MULTI-AGENT.md](AI-MULTI-AGENT.md).

Verifikasi akhir multi-agent: 76/76 tes regresi, build TypeScript, sintaks JavaScript, dan browser desktop/mobile lulus. Pembatasan eksternal tetap pada autentikasi provider (401) dan uji HP.

## Sumber data client — 17 September 2026

- [x] Knowledge/Perilaku AI diisi client; seluruh agent memakai shared memory otomatis.
- [x] Tabel Produk/Layanan dan Order/Pesanan per tenant/session, pengelolaan melalui UI/API.
- [x] Pilihan sumber builtin/custom endpoint yang independen, token terenkripsi, kontrak tools seragam.
- [x] Harga snapshot, idempotensi create, pembatasan order per pelanggan, dan perlindungan endpoint privat/redirect.
- [x] Build, 86/86 tes regresi, UI desktop/mobile dan error formulir lulus.
- [ ] Verifikasi endpoint client nyata dan HP WhatsApp (pengujian otomatis memakai transport tiruan).

Keputusan ini menggantikan mode demo pada catatan sebelumnya. Kontrak endpoint dan batas pencatatan order dijelaskan di AI-MULTI-AGENT.md.

## Auto Share — 18 September 2026

- [x] Menu Auto Share: kontak/kelompok, template pesan teks, dan riwayat 100 pengiriman terakhir.
- [x] Tabel `daftar_kontak` dan tabel template/run/tujuan, isolasi tenant dan deduplikasi nomor/ID grup.
- [x] Simpan kontak yang belum terdaftar dari Ambil alih percakapan AI.
- [x] Kirim manual dan jadwal sekali/berulang; sesi pengirim dipilih pada template.
- [x] Antrean persisten, snapshot tujuan/pesan, pengiriman berkredit berurutan, mengetik 1 detik dan jeda acak 1–3 detik.
- [x] Pemulihan restart tanpa retry hasil tidak pasti; status per tujuan dan kegagalan tidak menghentikan tujuan berikutnya.
- [ ] Uji pengiriman dan tampilan mengetik pada HP WhatsApp/grup nyata (otomatis menggunakan transport tiruan).

Verifikasi Auto Share: 5/5 tes terarah pada MySQL sementara lulus; browser desktop/mobile lulus untuk pintasan AI, template, jadwal aktif/nonaktif, kirim manual, detail riwayat, dan pencegahan origin tidak valid. TypeScript check/build, sintaks JavaScript, dan diff whitespace lulus. Regresi penuh pada database baru: 118/119 lulus; satu kegagalan tes batas memori AI dicatat di DEBUG.MD dan tidak diubah dalam fitur ini.

## Pemisahan konten dan jadwal Auto Share — 18 September 2026

- [x] Template konten independen dari sesi, tujuan, dan jadwal; tab Pengiriman/Jadwal terpisah.
- [x] Rotasi template persisten per jadwal, urutan dapat diubah, satu template per eksekusi untuk semua tujuan.
- [x] Kirim manual memilih template tanpa menggeser rotasi; template yang dipakai pengiriman dilindungi dari penghapusan.
- [x] Teks/link serta gambar/video/dokumen/audio melalui URL media publik; snapshot jenis/URL/caption pada riwayat.
- [x] Migrasi lama ke tabel auto_share_jobs, mempertahankan jadwal dan konten serta idempoten setelah pengiriman dihapus.
- [x] Tujuh tes backend terisolasi, alur browser desktop/mobile, TypeScript dan build lulus.
- [ ] Verifikasi media dan rotasi pada perangkat WhatsApp nyata (pengujian menggunakan transport/unduhan tiruan).

## Sumber data endpoint pada template Auto Share — 23 September 2026

- [x] Template dapat menarik nilai hidup dari endpoint HTTPS milik pengguna dan menyisipkannya ke teks/caption lewat `{{nama_variabel}}`.
- [x] Kontrak dipegang nc-wa-saas: `GET` menjawab `{"data":{…}}` objek datar, maksimal 50 variabel, nilai teks/angka/boolean maksimal 200 karakter, respons 32 KB, timeout 10 detik.
- [x] Angka diformat gaya Indonesia dan boolean menjadi Ya/Tidak; `{{{{` melarikan kurung kurawal literal.
- [x] Variabel yang tidak tersedia membatalkan seluruh pengiriman dan dicatat sebagai run gagal, bukan mengirim pesan setengah jadi.
- [x] Sumber media opsional lewat `{"media":{"url":…}}`: diunduh sekali per pengiriman, jenisnya disahkan dari byte asli, batas 8 MB.
- [x] Media sumber disimpan sebagai asset sementara ber-`run_id`, dikecualikan dari daftar galeri dan kuota paket, dihapus saat run selesai serta disapu ulang oleh `recover()` setelah proses terhenti.
- [x] Pengambilan data dilakukan sebelum transaksi dibuka agar endpoint lambat tidak menahan kunci akun maupun memblokir tick penjadwal.
- [x] Token disimpan terenkripsi, tidak pernah dikirim ke browser, dan otomatis dilepas saat URL endpoint diganti.
- [x] Tombol "Tes koneksi" menampilkan variabel beserta nilainya dan menyisipkannya ke posisi kursor.
- [x] Tes: 13/13 Auto Share lulus; regresi penuh 141/142 (satu kegagalan batas memori AI pra-eksisting, lihat DEBUG.MD). TypeScript check, build, dan sintaks JavaScript lulus.
- [ ] Alur browser belum terverifikasi: `scripts/browser-auto-share-check.ts` berhenti pada `saveAssistant` karena kegagalan pra-eksisting di luar Auto Share (lihat DEBUG.MD).
- [ ] Verifikasi endpoint dan media sumber pada perangkat WhatsApp nyata (pengujian menggunakan transport/unduhan tiruan).
