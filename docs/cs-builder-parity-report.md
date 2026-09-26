# CS Usaha lengkap pada builder dinamis

## Hasil penyempurnaan

Kekurangan fungsional yang ditemukan pada audit awal sudah ditangani: operasi bisnis CS tersedia pada Tool, ekstraksi Pesanan mengikuti konfigurasi node, pemeriksaan pesanan memakai pelanggan dari server, dan Agent dapat menuju Fallback melalui port yang dihubungkan. Router menangani tiket yang masih menunggu.

Draft pengembangan sebelumnya diperbarui menjadi **CS Usaha lengkap**, belum diterbitkan atau diaktifkan untuk klien:

`/dashboard/admin/ai-builder?profile=g_10fe7f9938664ae483e402127860`

Definisi portabel terbaru: [cs-complete.profile.json](examples/cs-complete.profile.json). Template yang sama tersedia saat membuat profil. Ekspor hanya membawa definisi, bukan data klien/kredensial. Berkas `cs-parity.profile.json` adalah artefak audit awal yang masih menunjukkan kekurangan lama.

## Kemampuan

| Bagian | Implementasi |
|---|---|
| Lima specialist CS | Prompt dan izin tool pembuka, profil_perusahaan, layanan, penutup, lainnya mengikuti CS bawaan |
| Router | Tier Keputusan, cabang bebas, dan pemilihan tiket terkait; JEV memakai Choice dan Noul |
| Shared Memory | Resource dapat dihubungkan/dilepas; router menggunakan ringkasan, specialist menggunakan riwayat |
| Knowledge/katalog | Tool bisnis membaca data profil dan katalog melalui layanan yang sama dengan CS bawaan |
| Pesanan | Parser teks, ekstraksi AI bila perlu, validasi item/harga/stok, serta idempotensi tersimpan |
| Status pesanan | Pembatasan akun, data profil, dan pelanggan dari server |
| Foto produk | Pemilihan melalui Tool; diteruskan ke adapter media runtime setelah jawaban berhasil |
| Fallback | Agent memiliki port opsional yang dapat dihubungkan ke node Fallback atau jalur penanganan lain |
| Context/Output | Ringkasan bersama dan jawaban akhir mengikuti graf |
| Data profil | Menu usaha, produk, sumber data, pesanan, dan koleksi kustom tersedia sesuai kemampuan profil |
| Sandbox | Data bisnis dan koleksi dummy terpisah; tidak menulis pesanan klien atau mengirim WhatsApp |

Operasi bisnis memakai tabel bersama yang sudah ada, bukan membuat tabel baru per profil. Koleksi dengan struktur bebas tetap tersedia melalui Tool koleksi. Pesanan mengikuti aturan CS bawaan: validasi stok tidak berarti reservasi/pengurangan stok, dan pesanan masuk belum berarti pembayaran berhasil.

## Bukti pengujian

- **17 tes CS**: lima cabang specialist, simpan/publikasi, pembacaan, isolasi pelanggan, pesanan, gambar, stok, penolakan harga dari AI, duplikasi, ekstraksi, fallback, tiket menunggu, serta dispatch tool nyata ke database terisolasi.
- **16 tes builder**: graf, koneksi memori, revisi, skema, relasi, isolasi tenant, impor/ekspor, dan CRUD.
- **8 tes integrasi profil**: berbagi data profil, isolasi, ganti/cabut, duplikasi foto, aktivasi, uji coba, dan pemakaian versi graf terbit pada engine WhatsApp tiruan.
- **Browser 1280/390 px**: editor umum dan CS; tampilan lima Agent, memori, port fallback, publikasi, serta pengelolaan katalog dinamis.
- **Pemeriksaan kode/build**: TypeScript, aturan lapisan, Prettier, dan build.

Tes database menggunakan MySQL sementara. Foto pada tes adapter memakai metadata sintetis; pengiriman ke HP WhatsApp nyata belum diuji.

## Uji model asli

Provider terkonfigurasi memakai **typesafe/jev-1.13** dan **deepseek-v4-flash**. Empat skenario pada sandbox bisnis lulus:

| Skenario | Hasil | Durasi seluruh alur |
|---|---|---|
| Salam | Agent pembuka menjawab dan Context terbentuk | 5.001 ms |
| Pencarian produk | get_products; nama dan harga sesuai fixture | 7.642 ms |
| Pemesanan | get_products + create_order; tepat satu pesanan baru, total dan pelanggan sesuai | 10.265 ms |
| Foto | get_products + send_product_image; satu foto dipilih | 11.644 ms |

Metadata: [cs-parity-live-results.json](examples/cs-parity-live-results.json). Ini satu pengukuran per skenario, bukan benchmark. Pengujian memakai data sintetis tanpa pengiriman nyata; keberhasilan ini tidak menjamin semua variasi bahasa pelanggan akan ditangani sempurna.

## Mencoba

1. Buka draft **CS Usaha lengkap** di Editor Profil.
2. Pada **Pengujian**, isi **Data contoh bisnis** (`knowledge`, `products`, `orders`, `pending`). Pelanggan simulasi adalah `628000000001`.
3. Pilih node Tool untuk mengganti kemampuan; untuk `create_order`, tier/model/instruksi ekstraksi dapat disesuaikan.
4. Hubungkan atau lepas memori; aktifkan port Fallback pada Agent dan tentukan tujuannya.
5. Setelah siap, terbitkan dan aktifkan profil. Akun kemudian membuat Data Profil dan mengisi usaha/katalog di **Kelola isi**.
