# Rencana Fitur Asisten AI WhatsApp

Tanggal: 16 September 2026.

Status: implementasi versi pertama tersedia. Bagian 10 mencatat keputusan pengguna, aturan teknis yang diterapkan, dan batas pengujian; bagian awal mempertahankan konteks rencana.

## 1. Tujuan

Pengguna dapat mengaktifkan asisten untuk membalas chat WhatsApp berdasarkan pengetahuan dan perilaku bisnisnya. Pemilik layanan mengelola koneksi AI, model, harga kredit, tarif penggunaan, dan batas memori global.

## 2. Pengaturan pengguna

| Fitur | Target |
| --- | --- |
| Aktif/nonaktif | Pengguna dapat menghidupkan atau mematikan balasan otomatis |
| Pengetahuan | Pengguna mengisi informasi bisnis, produk, harga, jam layanan, dan FAQ |
| Perilaku | Pengguna mengatur gaya bahasa, cara menjawab, dan arahan saat informasi tidak tersedia |

Saat asisten dinonaktifkan, asisten tidak membuat balasan otomatis baru. Pengaturan berlaku per nomor WhatsApp layanan, sesuai keputusan pengguna.

## 3. Pengaturan pemilik

Tersedia menu **Pengaturan AI**, serupa pengaturan Midtrans.

| Pengaturan | Target |
| --- | --- |
| Endpoint | Menentukan layanan AI yang digunakan |
| API key | Mengatur kredensial penyedia AI |
| Model | Menentukan model untuk asisten |
| Harga jual kredit AI | Menentukan harga pembelian kredit oleh pengguna |
| Tarif input | Menentukan kredit per kata input; acuan awal 1 kredit per kata |
| Tarif output | Menentukan kredit per kata jawaban; contoh 2 kredit per kata, dapat disesuaikan |
| Batas memori global | Menentukan jumlah pesan yang disimpan per percakapan; default 3 pesan |

Harga jual kredit dan tarif penggunaan merupakan pengaturan berbeda. Pengguna tidak dapat mengubah konfigurasi AI milik pemilik atau batas memori global.

## 4. Saldo dan perhitungan kredit AI

Saldo AI terpisah dari saldo kredit WhatsApp. **Kredit AI dihitung oleh sistem berdasarkan jumlah kata dan tarif input/output**, menggantikan rencana sebelumnya yang memakai token penyedia.

```text
Potongan kredit AI = (jumlah kata input × tarif input)
                  + (jumlah kata output × tarif output)
```

- Input mencakup teks pengetahuan, perilaku, memori, dan pesan terbaru yang benar-benar disertakan dalam permintaan AI. Pesan terbaru tidak dihitung dua kali.
- Output mencakup teks jawaban AI yang dihasilkan untuk pelanggan.
- Teks yang sama, misalnya pengetahuan atau memori, dihitung kembali jika disertakan pada permintaan berikutnya.
- Perhitungan dilakukan oleh sistem NC-WA SaaS, bukan berdasarkan estimasi dari jawaban AI atau laporan token penyedia.
- Tarif input/output dicatat saat permintaan dimulai agar perubahan tarif tidak memengaruhi permintaan yang sedang berjalan.
- Jika jawaban AI sudah dihasilkan tetapi pengiriman WhatsApp gagal, kredit AI tetap dibebankan sesuai kata input dan jawaban tersebut.
- Pengiriman balasan tetap mengikuti aturan kredit WhatsApp yang sudah ada.
- Biaya yang dibayar pemilik kepada SumoPod tetap mengikuti aturan penyedia. Jumlah kata untuk kredit pelanggan tidak dianggap sama dengan jumlah token penyedia.

**Contoh:** 500 kata input dengan tarif 1 kredit/kata dan 100 kata output dengan tarif 2 kredit/kata menghasilkan potongan **700 kredit AI**.

Usulan definisi kata: setiap bagian teks yang dipisahkan spasi atau baris baru dihitung satu kata; spasi berulang diabaikan dan teks kosong bernilai nol. Detail tanda baca, URL, emoji, serta bahasa tanpa spasi perlu ditetapkan sebelum implementasi.

## 5. Memori percakapan

Memori dipisahkan dengan susunan:

**Akun pengguna → nomor WhatsApp layanan → nomor pelanggan yang berinteraksi → memori chat**

- Default maksimal **3 pesan terbaru**, bukan tiga pasangan pesan.
- Pesan pelanggan dan jawaban asisten masing-masing dihitung sebagai satu pesan.
- Beberapa pesan berturut-turut dari pihak yang sama tetap dihitung satu per satu.
- Setiap penambahan pesan yang melewati batas otomatis menghapus pesan paling lama dari memori AI.
- Pesan terbaru termasuk dalam batas tersebut, bukan tambahan di luar tiga pesan.
- Pengetahuan dan perilaku tidak termasuk hitungan pesan memori.
- Penghapusan memori tidak menghapus chat di WhatsApp.
- Isi memori terpisah untuk setiap pelanggan, nomor layanan, dan akun. Hanya batas jumlah pesannya yang global dan dapat diubah pemilik.

**Contoh:** pesan 1, 2, 3 tersimpan. Ketika pesan 4 masuk, pesan 1 dihapus dan memori berisi pesan 2, 3, 4. Aturan yang sama berlaku saat menambahkan jawaban asisten.

## 6. Penyedia AI awal

Penyedia awal adalah **SumoPod**, menggunakan Chat Completions sesuai Quick Start yang diberikan pengguna.

| Acuan pengembangan | Nilai |
| --- | --- |
| Endpoint dasar | `https://ai.sumopod.com` |
| Endpoint chat | `https://ai.sumopod.com/v1/chat/completions` |
| Model awal | `deepseek-v4-flash` |
| Konfigurasi lokal | `apikey_ai`, `endpoint_ai`, dan `model_ai` di `.envpengembangan` |

Konfigurasi lokal menjadi acuan awal; target pengelolaan tetap melalui menu pemilik. Nilai API key tidak dicantumkan di dokumen, log, atau repository. File konfigurasi lokal tidak dikirim ke browser.

Quick Start dan konfigurasi sudah ditinjau, tetapi model dan koneksi belum diuji menggunakan API key. Laporan token penyedia dapat membantu pemantauan biaya pemilik, tetapi bukan dasar potongan kredit pelanggan. Dukungan penyedia lain belum menjadi target wajib.

## 7. Usulan cakupan versi pertama

Bagian ini merupakan rekomendasi, belum seluruhnya menjadi keputusan final.

- Balasan otomatis untuk pesan teks pribadi; grup dan media menyusul.
- Jawaban dikirim sebagai satu pesan lengkap, bukan potongan streaming.
- Tombol tes koneksi AI untuk pemilik.
- Saldo dan riwayat penggunaan AI untuk pengguna: jumlah kata input/output, tarif yang berlaku, dan kredit yang dipotong.
- Asisten berhenti membalas ketika saldo AI atau WhatsApp tidak mencukupi.
- Batas panjang input dan jawaban serta pengendalian saldo agar kredit tidak negatif; batas tiga pesan saja tidak membatasi jumlah kata.
- Penanganan pesan beruntun, gangguan koneksi, dan restart tanpa balasan atau potongan ganda.
- Penyimpanan API key secara terenkripsi.
- Jeda asisten per percakapan agar admin dapat mengambil alih pelayanan.

## 8. Keputusan yang masih terbuka

- Sakelar asisten dan pengaturan pengetahuan/perilaku berlaku per akun atau per nomor layanan.
- Kredit AI dibeli terpisah, termasuk paket, atau keduanya; termasuk satuan penjualan, harga, dan masa berlaku saldo.
- Nilai awal tarif output; angka 2 kredit per kata masih contoh. Batas nilai tarif dan dukungan angka pecahan juga perlu ditentukan.
- Definisi final kata, termasuk perlakuan tanda baca, URL, emoji, dan bahasa tanpa spasi.
- Batas panjang pengetahuan, input, dan jawaban; serta perlakuan jawaban yang melebihi saldo tersedia.
- Aturan potongan ketika permintaan AI gagal, jawaban kosong, atau hasilnya tidak diketahui akibat timeout. Kegagalan ini dibedakan dari jawaban yang sudah dihasilkan tetapi gagal dikirim ke WhatsApp.
- Perlakuan memori ketika batas global diturunkan, asisten dimatikan, atau pengguna ingin menghapus konteks.

## 9. Kriteria penerimaan target utama

- Pengguna dapat mengatur pengetahuan, perilaku, dan status aktif asisten sesuai cakupan yang dipilih.
- Pemilik dapat mengatur endpoint, API key, model, harga jual kredit, tarif input/output, dan batas memori global.
- Dengan tarif input 1 dan output 2, penggunaan 500 kata input dan 100 kata output memotong tepat 700 kredit AI.
- Perubahan tarif tidak mengubah perhitungan permintaan yang sudah dimulai.
- Potongan kredit AI dihitung dari kata; kredit WhatsApp tetap tercatat terpisah.
- Memori default tidak melebihi tiga pesan, termasuk saat pelanggan mengirim beberapa pesan berturut-turut.
- Pesan tertua yang melewati batas terhapus dari memori AI tanpa menghapus chat WhatsApp.
- Memori tidak tercampur antarpelanggan, nomor layanan, atau akun.
- Perubahan batas memori oleh pemilik berlaku global sesuai aturan penerapan yang diputuskan.
- Asisten menggunakan koneksi dan model SumoPod yang dikonfigurasi pemilik; akses model dibuktikan saat pengujian integrasi.


## 10. Implementasi — 16 September 2026

Keputusan pengguna saat implementasi:

- Asisten diatur **per nomor WhatsApp**.
- Tarif awal input **1** kredit/kata dan output **2** kredit/kata. Pemilik dapat mengubah tarif.
- Kredit AI dibeli **terpisah melalui QRIS, per 1.000 kredit, tanpa kedaluwarsa**. Harga rupiah ditetapkan pemilik. Harga 0 menutup pembelian baru; tidak menghapus saldo.

Aturan versi pertama yang diterapkan:

- Kata = bagian teks nonkosong yang dipisahkan whitespace (`\S+`): tanda baca menempel, URL, emoji, dan teks tanpa spasi masing-masing satu bagian. Seluruh teks pesan system (termasuk arahan teknis), pengetahuan, perilaku, dan memori dihitung berdasarkan payload yang benar-benar dikirim.
- Tarif bulat: input 0–1.000 dan output 1–1.000 kredit/kata. Harga per 1.000 kredit 0–1.000.000 rupiah. Pecahan belum didukung.
- Pengetahuan maksimal 8.000 karakter, perilaku 2.000 karakter, pesan pelanggan 4.000 karakter. Payload maksimal 12.000 kata. Jawaban maksimal 300 kata/8.000 karakter, dikurangi sesuai saldo tersedia.
- Saldo dicadangkan sebelum pemanggilan AI; sisa cadangan dikembalikan setelah pemakaian aktual diketahui. Timeout, jawaban kosong, respons tidak valid, atau jawaban melewati batas diperlakukan sebagai kegagalan AI: tidak diteruskan dan tidak dikenai kredit pelanggan. Biaya penyedia untuk kegagalan tersebut menjadi tanggungan pemilik.
- Jawaban valid yang telah dihasilkan tetap ditagih jika WhatsApp gagal atau jika pengiriman dibatalkan karena asisten/konteks berubah selama proses. Kredit WhatsApp mengikuti reservasi dan hasil kirim yang sudah ada.
- Memori 1–50 pesan, default 3. Penurunan batas langsung memangkas semua memori. Mematikan asisten mempertahankan memori. Pengguna dapat menjeda atau menghapus konteks per pelanggan. Hapus session menghapus pengaturan dan memori AI session tersebut, tetapi mempertahankan riwayat tagihan.
- Antrean per percakapan menjaga urutan; reservasi saldo dikunci per akun. Identitas pesan masuk mencegah panggilan, kirim, dan tagihan ulang. Saat restart, permintaan AI yang belum memiliki hasil tersimpan dibatalkan dan cadangannya dikembalikan. Hasil kirim ambigu tidak dikirim ulang otomatis. Pesan yang masih menunggu dalam antrean RAM tidak diputar ulang otomatis setelah crash.
- Kunci AI terenkripsi AES-256-GCM menggunakan `PAYMENT_ENCRYPTION_KEY` yang sudah tersedia. Backup kunci ini tetap diperlukan untuk membaca konfigurasi terenkripsi. Endpoint HTTPS publik, DNS dipatok saat koneksi, tanpa redirect membawa kredensial.

Menu pengguna: `/dashboard/ai`. Menu pemilik: `/dashboard/admin/ai`.

Migrasi: `npm run migrate`. Bootstrap lokal opsional: `npx tsx --env-file=.env scripts/setup-ai.ts --test`. Skrip hanya membaca `.envpengembangan` secara lokal, tidak menimpa konfigurasi yang telah tersedia, dan tidak mencetak kredensial.

Verifikasi nyata: koneksi Chat Completions SumoPod dengan model dari konfigurasi lokal berhasil diuji. Pengiriman WhatsApp nyata dan pembayaran QRIS merchant nyata belum diuji untuk fitur AI; tes otomatis memakai connector dan pembayaran tiruan.

Hasil verifikasi akhir [agent]: TypeScript, sintaks JavaScript, build, dan browser desktop/mobile lulus. Suite penuh dijalankan sekali: 55/56 lulus; kegagalan batas body telah diperbaiki dan rangkaian terarah AI/keamanan 12/12 lulus. Tes pembayaran 8/8 lulus, termasuk settlement AI idempoten. Pengujian pemulihan diperiksa ulang khusus sesudah pembatasan cleanup ke akun fixture. Suite penuh tidak diulang setelah perbaikan terarah.

## 11. Balasan natural — 16 September 2026

Pesan yang memenuhi syarat untuk dibalas ditandai dibaca sebelum AI dipanggil. Setelah jawaban siap, asisten mengirim presence `composing`, menunggu durasi acak 1.000–3.000 ms, lalu mengirim jawaban. Presence `paused` dikirim sesudah pengiriman selesai, gagal, atau dibatalkan. Read/presence bersifat best effort: kegagalannya tidak menggagalkan balasan atau menambah kredit. Status asisten/konteks diperiksa lagi setelah jeda dan tepat sebelum pengiriman; jeda/hapus konteks selama menunggu tetap membatalkan balasan. Pesan duplikat tidak mengulang urutan ini.

Verifikasi [agent]: 13/13 tes AI lulus (termasuk urutan read → generate → composing → jeda → kirim → paused, batas durasi random, kegagalan presence, kegagalan kirim, dan pembatalan selama jeda), TypeScript dan build lulus. Tampilan presence/read pada HP WhatsApp nyata belum diuji.

## 12. Ambil alih otomatis — 16 September 2026

Balasan manual dari nomor layanan melalui HP/WhatsApp Web otomatis menjeda AI khusus pelanggan penerima. Pelanggan lain tetap dilayani; pengguna melanjutkan lewat tombol **Lanjutkan AI**. Jawaban AI yang belum dikirim diperiksa ulang dan dibatalkan ketika revision percakapan berubah; pesan yang sudah diserahkan ke WhatsApp tidak dapat ditarik kembali oleh mekanisme ini.

Semua pengiriman sistem (AI/API/dashboard uji pesan) menentukan ID Baileys dan menyimpannya di `ai_message_origins` sebelum pemanggilan jaringan. Event `fromMe` dengan ID tersebut diabaikan, termasuk setelah restart. Event manual dicatat secara idempoten bersama perubahan status dan memori dalam satu transaksi, sehingga duplikat tidak menjeda ulang percakapan yang telah dilanjutkan. ID dipisahkan per akun dan session.

Deteksi hanya berlaku pada event langsung `notify` untuk percakapan pribadi. History `append`, pesan bertimestamp sebelum koneksi dibuat, grup, broadcast, reaction, dan perubahan protokol diabaikan. Nomor alternatif LID digunakan, atau dicari dari mapping Baileys; penerima yang belum dapat dipetakan ke nomor telepon tidak dijeda secara otomatis. Teks/caption manual masuk memori sebagai balasan admin; media tanpa teks, stiker, kontak, lokasi, dan polling memakai penanda jenis pesan. Batas memori global tetap berlaku; panjang satu catatan manual dibatasi 4.000 karakter.

Migrasi tambahan `ai_message_origins` sudah dijalankan lokal. Status tabel dashboard diperbarui dengan tombol **Perbarui saldo & riwayat**. Tidak ada kredit tambahan untuk deteksi manual atau jeda. Pengujian memakai event/connector tiruan; deteksi lintas HP/WhatsApp Web nyata masih memerlukan uji perangkat.
