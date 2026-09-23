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

## Form sumber data dipilih di awal dan header bebas — 23 September 2026

- [x] Urutan form template mengikuti keputusan: nama, sumber data, lalu jenis konten dan teks. Memilih "Tidak ada" membuat form kembali seperti semula.
- [x] Blok endpoint hanya muncul saat sumber data dipilih; opsi media "Dari endpoint" tidak ditawarkan sebelum sumber data aktif, sehingga pilihan yang pasti ditolak tidak lagi tampil.
- [x] Bearer token tunggal diganti header bebas (nama dan nilai), mencakup API key dengan nama header apa pun. Maksimal 10 header, nilai 1024 karakter, menolak header yang diatur otomatis dan nilai bermuatan baris baru.
- [x] Nilai header disimpan terenkripsi sebagai satu JSON; template lama yang menyimpan token tunggal tetap terbaca sebagai `Authorization: Bearer`.
- [x] Tombol Tes menampilkan jumlah variabel, respons mentah endpoint, dan daftar variabel yang dapat diklik untuk disisipkan ke posisi kursor.
- [x] Daftar variabel dipindah ke atas kolom teks agar terlihat saat menulis pesan.
- [x] Tes: 14/14 Auto Share lulus; regresi penuh 142/143 (satu kegagalan batas memori AI pra-eksisting). `scripts/browser-template-source-check.ts` lulus pada desktop dan ponsel. TypeScript check, build, dan sintaks JavaScript lulus.

## Kontrak sumber data menerima respons apa adanya — 23 September 2026

- [x] Pembungkus `data` tidak lagi wajib: respons berupa objek datar di akar diterima langsung, sehingga endpoint yang sudah ada tidak perlu diubah. Bila `data` ada, isinya tetap yang dipakai.
- [x] Batas panjang nilai dinaikkan 200 menjadi 1000 karakter, agar kalimat yang sudah dirakit di sisi server dapat dipakai langsung sebagai satu variabel.
- [x] Nama variabel menerima huruf besar, sehingga kunci `camelCase` milik API yang sudah ada tetap berlaku.
- [x] Pada respons tanpa pembungkus, key `media` berisi objek diperlakukan sebagai blok media dan tidak ikut dibaca sebagai variabel.
- [x] Diverifikasi terhadap endpoint nyata `https://mahadalyusro.sch.id/cekpsb`: empat variabel terbaca (`darul_ilmi`, `madrasah`, `mahdon_tarbawi`, `mahad_aly`) dan tersubstitusi tanpa perubahan apa pun di sisi penyedia data.
- [x] Tes: 14/14 Auto Share lulus; regresi penuh 142/143 (satu kegagalan batas memori AI pra-eksisting). Pemeriksaan browser form lulus desktop dan ponsel. TypeScript check, build, dan sintaks JavaScript lulus.

## Media sumber data dipilih dari variabel — 23 September 2026

- [x] Blok `media` khusus dihapus dari kontrak: alamat file cukup dikirim sebagai variabel biasa, lalu dipilih pada dialog template melalui "Variabel berisi link media".
- [x] Endpoint tidak perlu format khusus apa pun; satu respons objek datar melayani teks maupun media.
- [x] Nama berkas diturunkan dari alamatnya, sehingga penyedia data tidak perlu mengirim `filename`.
- [x] Daftar pilihan variabel media terisi dari hasil Tes koneksi; pilihan tersimpan tetap terbaca saat template dibuka kembali.
- [x] Pesan kesalahan spesifik untuk variabel yang tidak ada, kosong, atau bukan alamat HTTPS publik.
- [x] Tes: 15/15 Auto Share lulus; regresi penuh 143/144 (satu kegagalan batas memori AI pra-eksisting). Pemeriksaan browser form lulus desktop dan ponsel. TypeScript check, build, dan sintaks JavaScript lulus.

## Perbaikan notifikasi dan form template — 23 September 2026

- [x] Notifikasi `#message` naik ke top layer melalui `popover`, sehingga tidak lagi tertutup dialog yang dibuka `showModal()`; z-index saja tidak cukup untuk elemen top layer.
- [x] Pembukaan dan penutupan notifikasi dipusatkan pada satu `MutationObserver`, tanpa mengubah 35 pemanggilan yang sudah ada.
- [x] Dropdown asset menampilkan keterangan saat galeri tidak memuat jenis media yang dipilih, menggantikan form yang terkunci tanpa penjelasan.
- [x] Migrasi kolom sumber data dijalankan pada database pengembangan; kegagalan simpan template sebelumnya berasal dari kolom yang belum ada, bukan dari kode (lihat DEBUG.MD).
- [x] Pemeriksaan browser diperluas: menyimpan template sampai tuntas dan memastikan notifikasi benar-benar berada di lapisan teratas.
- [x] Tes: 15/15 Auto Share lulus; regresi penuh 143/144 (satu kegagalan batas memori AI pra-eksisting). TypeScript check, build, dan sintaks JavaScript lulus.

## Perbaikan UX form pengiriman/jadwal — 23 September 2026

- [x] Seluruh penolakan `jobInput` kini terlihat sebelum permintaan dikirim: template kosong, tujuan kosong, waktu kosong, dan waktu di masa lalu ditampilkan sebagai daftar "Lengkapi dulu" dengan tombol simpan dinonaktifkan.
- [x] Input waktu memakai atribut `min`, sehingga waktu lampau tidak dapat dipilih dari pemilih tanggal.
- [x] Ringkasan tujuan menampilkan jumlah tujuan unik beserta jumlah nomor yang tumpang tindih antara kontak dan kelompok, menjawab "ini terkirim ke berapa orang" sebelum disimpan.
- [x] Kontak tujuan diganti daftar checkbox dengan kotak pencarian, menggantikan `<select multiple>` yang memerlukan Ctrl/Cmd dan tidak dapat dipakai di ponsel.
- [x] Checkbox aktifkan jadwal, waktu, dan pengulangan dikelompokkan dalam satu fieldset; bidang waktu diredupkan saat jadwal tidak diaktifkan.
- [x] Peringatan muncul bila sesi pengirim tidak berstatus connected atau sudah tidak tersedia, tanpa memblokir penyimpanan.
- [x] Pratinjau rotasi menampilkan urutan tiga template pertama saat lebih dari satu template dipakai.
- [x] Dropdown sesi menampilkan keterangan saat belum ada sesi WhatsApp, menggantikan form yang terkunci tanpa penjelasan.
- [x] Tes: `scripts/browser-job-form-check.ts` lulus desktop dan ponsel; regresi penuh 143/144 (satu kegagalan batas memori AI pra-eksisting). TypeScript check, build, dan sintaks JavaScript lulus.

## Rapikan otomatis pesan Auto Share dengan AI — 23 September 2026

- [x] Checkbox "Rapikan otomatis dengan AI" pada template bersumber data endpoint; teks hasil substitusi dirapikan Model Murah sekali per pengiriman, bukan per kontak.
- [x] Prompt dapat diatur owner pada Pengaturan AI (`ai_settings.tidy_prompt`); kosong berarti memakai prompt bawaan sehingga fitur langsung berfungsi.
- [x] Kegagalan AI, kredit tidak cukup, atau hasil yang ditolak tidak membatalkan pengiriman: pesan tetap terkirim apa adanya dan alasannya dicatat pada `auto_share_runs.tidy_note`.
- [x] Hasil ditolak bila kosong, melebihi 10.000 karakter, atau menyusut di bawah 40% panjang asli sebagai tanda model memotong isi.
- [x] Kredit dipesan lalu diselesaikan mengikuti pola asisten; kredit untuk panggilan gagal dikembalikan penuh dan tercatat di `ai_usage` dengan agent `rapikan`.
- [x] Tombol Tes koneksi menampilkan pratinjau pesan akhir termasuk hasil perapihan, sehingga jadwal tidak dinyalakan untuk keluaran yang belum pernah dilihat.
- [x] Perapihan hanya ditawarkan untuk template bersumber endpoint dan bukan audio; teks statis lebih murah dirapikan sekali saat menyimpan.
- [x] Tes: 17/17 Auto Share lulus; regresi penuh 145/146 (satu kegagalan batas memori AI pra-eksisting). Pemeriksaan browser lulus desktop dan ponsel. TypeScript check, build, dan sintaks JavaScript lulus.

## Cache busting aset front-end dan letak tombol pratinjau — 23 September 2026

- [x] Setiap halaman merujuk `app.js`, `style.css`, `ai-studio.js`, dan `ai-studio.css` dengan hash isi berkas, sehingga peramban tidak lagi memakai berkas lama setelah pembaruan.
- [x] Aset berhash dilayani `Cache-Control: immutable` selama satu tahun; aset tanpa hash tetap divalidasi ulang agar tautan lama tidak tertahan selamanya.
- [x] Tombol "Lihat pratinjau pesan" dipindah ke bawah kolom teks bersama hasilnya, menggantikan pratinjau yang sebelumnya menumpang tombol Tes koneksi di atas checkbox rapikan sehingga alurnya terbalik.
- [x] Tombol pratinjau dan pilihan rapikan hanya tampil untuk template bersumber endpoint, dan ikut tersembunyi saat sumber dimatikan.
- [x] Tes: `test/assets.test.ts` memastikan hash berasal dari isi berkas dan tidak ada rujukan tanpa versi yang tersisa; regresi penuh 147/148 (satu kegagalan batas memori AI pra-eksisting).

## Perbaikan pilihan rapikan tidak tersimpan — 23 September 2026

- [x] `tidy` dikembalikan ke payload penyimpanan template; sebelumnya kotak centang selalu tersimpan `0` sehingga pengiriman terjadwal tidak pernah merapikan meski pratinjau menampilkan hasil yang benar.
- [x] Pemeriksaan browser mencegat POST `/auto-share/templates` dan memastikan payload memuat `tidy`, `source_mode`, dan `source_endpoint`.
- [x] Pemeriksaan dikonfirmasi menangkap kesalahan tersebut dengan mengembalikan bug sementara lalu menjalankan ulang.
- [x] Tes: 17/17 Auto Share lulus; regresi penuh 147/148 (satu kegagalan batas memori AI pra-eksisting).

## Perbaikan centangan rapikan tidak dipulihkan — 23 September 2026

- [x] `openShareTemplate` memulihkan `tidy` dari data template; sebelumnya centangan selalu kosong saat template dibuka untuk diubah, sehingga penyuntingan berikutnya menghapus nilai yang sudah tersimpan.
- [x] Pemulihan ditempatkan setelah `shareMediaFields()` yang mengosongkan centangan saat menilai perapihan tidak berlaku.
- [x] Area pratinjau direset saat dialog dibuka agar hasil template sebelumnya tidak tertinggal.
- [x] Pemeriksaan browser memverifikasi perjalanan bolak-balik: simpan lalu buka ulang wajib memulihkan centangan, sumber data, dan endpoint.
- [x] Tes: 17/17 Auto Share lulus; regresi penuh 147/148 (satu kegagalan batas memori AI pra-eksisting).

## Catatan perapihan per template — 23 September 2026

- [x] Kolom "Catatan perapihan" pada template, muncul setelah rapikan otomatis dicentang; maksimal 500 karakter dan tersimpan pada `auto_share_templates.tidy_note`.
- [x] Catatan dikirim sebagai giliran pesan tersendiri, bukan disambung ke prompt pemilik layanan, dengan pembatas eksplisit bahwa isinya preferensi gaya semata.
- [x] Aturan pemilik layanan dinyatakan ulang sesudah catatan sehingga menjadi instruksi terakhir yang dibaca model; catatan yang mencoba membatalkan aturan terbaca sebagai data terkutip.
- [x] Pratinjau memakai catatan yang sedang diketik, sehingga pengaruhnya terlihat sebelum template disimpan.
- [x] Pemeriksaan browser memverifikasi catatan tersimpan dan dipulihkan saat template dibuka ulang.
- [x] Tes: 18/18 Auto Share lulus; regresi penuh 148/149 (satu kegagalan batas memori AI pra-eksisting).
