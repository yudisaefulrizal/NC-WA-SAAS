# Profil AI (graf)

Implementasi berdasarkan diskusi pemilik: editor visual dengan graf bebas, struktur data per profil, impor/ekspor definisi, serta pengujian terpisah dari data klien. Pemilik mengarahkan implementasi langsung di workspace; desain dan keputusan teknis dicatat di sini.

## Menggunakan fitur

1. Buka **Dashboard Admin → Profil AI → Buat profil · Editor alur · Impor JSON**, atau `/dashboard/admin/ai-builder`.
2. Buat profil kosong, impor berkas JSON, atau **Tempel JSON** (misalnya jawaban ChatGPT/Claude; blok ```json dan teks di sekitarnya dibuang otomatis). Profil baru berstatus draft dan belum aktif untuk klien. Lihat [Membuat profil dengan bantuan AI](#membuat-profil-dengan-bantuan-ai).
3. Tentukan koleksi pada **Struktur data**: daftar koleksi di kiri, tabel field koleksi terpilih di kanan (detail opsi, relasi, dan nilai bawaan dibuka per baris), dan daftar node yang memakainya. ID koleksi dan field dibuat otomatis dari namanya (misalnya "Jadwal Dokter" menjadi `jadwal_dokter`) dan tampil sebagai teks, bukan isian. Selama belum pernah diterbitkan, ID ikut nama dan rujukan di node Data (koleksi, filter, urutan, jumlah, serta variabel `...data.<field>`) ikut diganti; setelah terbit ID dikunci karena record klien memakainya, dan mengganti nama hanya mengubah tampilan. Field node Ekstrak mengikuti aturan yang sama untuk variabel `nodes.<node>.<field>`.
4. Susun node dan koneksi pada **Alur**. **Tambah node** (atau tombol `/`) membuka daftar node yang bisa dicari dan dipilih dengan panah + Enter, atau ditarik ke kanvas. Nama node wajib unik (huruf besar/kecil, spasi, dan `_` dianggap sama), spasi otomatis menjadi `_`, dan ID-nya dibentuk dari nama, sehingga `Layanan_pelanggan` dipakai sebagai `{{nodes.layanan_pelanggan.answer}}`; mengganti nama ikut mengganti ID beserta koneksi, tool Agent, memori, dan semua `{{nodes.<id>...}}` yang merujuknya, sedangkan ID acak dari editor lama (misalnya `agent_85314d14`) diganti otomatis saat profil dibuka, begitu pula spasi di nama lama. Tarik header node untuk memindahkan, sambungkan port keluar ke port masuk; peta mini di kanan bawah memindahkan tampilan. Setiap node berupa kartu dengan ilustrasi duotone yang menggambarkan fungsinya bagi orang awam (satu jenis node, satu ilustrasi; misalnya semua Agent memakai gambar yang sama), diikuti nama dan ringkasan isinya. **Rapikan** menyusun alur dari kiri ke kanan: jalur utama berkolom menurut jarak dari Input dengan cabang Router berurutan sesuai port, setiap node disejajarkan dengan sumber dan tujuannya (Output tepat di kanan Agent-nya, Router di tengah cabangnya), node data yang dipanggil Agent menjadi laci di kanan Agent-nya (data yang dipakai beberapa Agent setinggi rata-rata pemakainya), Output dan Fallback di kolom paling kanan (Fallback di bawah), memori di rel atas di atas node pemakainya, dan node yang tidak tersambung di kiri bawah tanpa saling menumpuk; hasilnya bisa dibatalkan dengan Urungkan. Inspector di kanan mengatur node terpilih; isian instruksi menandai setiap `{{variabel}}` (oranye bila tidak dikenal) dan **Sisipkan variabel** menaruh variabel di posisi kursor. Bagian Koneksi di inspector juga menjadi pemilih tujuan untuk keyboard/ponsel.
5. Tekan **Uji** untuk membuka uji coba di samping kanvas. Setiap jawaban punya **Jejak** per langkah (durasi, model, input dan hasil); jalur yang dijalankan diberi nomor dan disorot di kanvas, dan langkah yang gagal ditandai merah. Data contoh hanya berlaku untuk simulasi.
6. Draft tersimpan otomatis setelah jeda singkat (Ctrl+S menyimpan seketika). Masalah alur tampil di tombol **N masalah** pada bilah atas, pada node terkait, dan di **Pengaturan**; **Terbitkan** nonaktif selama masih ada masalah atau tidak ada perubahan sejak terbit. **Pengaturan** juga memuat status di klien, riwayat versi (pulihkan ke draft), ekspor, salin, dan hapus. Aktifkan profil melalui daftar **Profil AI** agar bisa dipilih akun. Daftar **Profil AI** juga punya **Hapus** (ditolak bila profil masih dipakai data profil klien) dan, untuk profil yang dipakai, **Hapus paksa** (`DELETE /api/admin/ai/builder/:id/force` dengan `revision`; pemilik harus mengetik nama profil): profil dinonaktifkan dulu, setiap data profil klien yang memakainya dicabut dari sesinya (memori dikosongkan dan catatan "Profil AI dicabut" dicatat, sama seperti tombol Cabut) lalu dihapus beserta record dan filenya (sama seperti hapus data profil oleh klien), baru profilnya dihapus; tercatat di audit sebagai `graph_force_deleted:<id>:<jumlah data profil>`.
7. Akun membuat **Data Profil**, memilih profil tersebut, lalu **Kelola isi**. Di **Knowledge** setiap koleksi profil menjadi sub-menu sendiri (grup Data, dengan jumlah record dan ikon untuk koleksi milik pelanggan), diikuti Perilaku AI dan Fallback Tim. Koleksi jenis tabel diisi langsung di tabel (inline): kolom dibentuk dari field dan cara mengisi sel mengikuti tipe field (teks/angka/telepon diketik di sel, pilihan dan relasi berupa daftar, multi pilihan dan teks panjang lewat popover yang menjadi lembar bawah di ponsel, ya/tidak dicentang, file diunggah dari sel). Perubahan disimpan per baris saat fokus meninggalkan baris atau Enter; baris kosong di bawah (dengan nilai bawaan) dipakai menambah record, dan baris koleksi milik pelanggan meminta nomor pelanggan yang terkunci setelah tersimpan. Field wajib dicek per sel, pesan server (misalnya nilai unik) tampil di baris itu, dan koleksi API tampil sebagai tabel yang sama tanpa mode ubah. Record dicari, difilter per pelanggan, dan dihapus di tempat; sumber data diatur lewat dialog **Sumber data**. Pasang Data Profil ke sesi di halaman Asisten AI; Knowledge sesi menampilkan hal yang sama untuk data profil yang terpasang. Tautan lama `/dashboard/ai-data?profile=…` diarahkan ke kelola data profil itu.

Semua profil AI adalah graf. Profil statis lama (CS Usaha, CS Lembaga Pendidikan, Tester AI) dan AI Studio sudah dihapus beserta data profil, tabel isi, dan filenya; tidak ada konversi otomatis. Template bawaan juga sudah dihapus; profil dimulai kosong, dari JSON, atau dengan bantuan AI lewat skill. Builder hanya berisi perkakas umum: tidak ada operasi khusus satu jenis usaha.

## Node dan kontrak eksekusi

| Node | Perilaku |
| --- | --- |
| Input | Menyediakan `input.message`, `input.context`, dan `input.history` |
| Memori percakapan (`memory`) | Resource riwayat untuk node AI yang dihubungkan lewat kunci `memory`; batas 0–60 pesan sebelumnya, terisolasi per akun/sesi/pelanggan; hanya dibaca |
| Memori konteks (`context_memory`) | Resource ringkasan S-P-O (maks. satu per profil); dibaca node AI lewat kunci `context_memory` sebagai `input.context`, hanya ditulis node Context |
| Router | Memilih satu cabang sesuai kriteria; tier Keputusan mendukung JEV melalui protokol keputusan yang sudah tersedia |
| Agent | Menghasilkan jawaban, atau memakai node Tool data yang diizinkan secara eksplisit |
| Kondisi | Satu atau beberapa syarat (semua/salah satu), boleh dengan grup DAN/ATAU satu tingkat; lihat **Kondisi** |
| Data (tipe `tool`) | Cari, Ambil, Buat, Ubah, Hapus, atau Hitung isi koleksi |
| Ekstrak | Mengubah pesan (dan riwayat bila memori terhubung) menjadi field terstruktur; lihat **Ekstrak** |
| Set / Hitung | Mengolah nilai dengan operasi tetap tanpa model; lihat **Set / Hitung** |
| Terima media | Menyimpan gambar/dokumen dari pelanggan sebagai file data profil; port Diterima/Tidak ada; lihat **Terima media** |
| Kirim media | Mengantrekan file dari field File/gambar atau URL HTTPS untuk dikirim bersama jawaban; lihat **Kirim media** |
| Context | Menyimpan ringkasan S-P-O untuk percakapan berikutnya (dari pesan terakhir dan jawaban AI); gagal membuat ringkasan tidak menggagalkan balasan |
| Output | Mengambil teks/variabel sebagai jawaban akhir |
| Fallback | Meneruskan kebutuhan ke mekanisme tiket tim yang sudah ada; memerlukan konfigurasi fallback sesi |

Graf bebas susun, satu jalur dipilih per pesan. Cabang boleh bertemu kembali. Setiap port harus memiliki tepat satu tujuan. Siklus, node tak terjangkau, referensi hilang, dan variabel yang belum tersedia pada seluruh jalur ditolak ketika simulasi/publikasi. Tool yang dilampirkan pada Agent tidak wajib mempunyai koneksi alur.

Batas format: 60 node, 180 koneksi, 30 koleksi, 50 field per koleksi. Runtime membatasi 60 langkah, 20 permintaan model logis, 5 putaran Agent, dan waktu 120 detik. Retry transport tetap dibatasi secara terpisah. Jawaban akhir mengikuti anggaran kata runtime, paling banyak 300 kata/8.000 karakter. Model yang salah format diberi satu kesempatan koreksi pada node Agent.

Variabel memakai `{{input.message}}`, `{{nodes.nama_node.answer}}`, atau variabel runtime `system.today|tomorrow|now|time|weekday` (WIB), `customer.phone|name` (nama profil WhatsApp; kosong di Uji Coba), dan `service.name` (nama data profil). Tidak ada `eval`, skrip pengguna, atau URL tool bebas. Konfigurasi koneksi provider dan secret berada di pengaturan AI server. Model khusus per node opsional; tidak mengubah penyedia/kredensial tier secara otomatis.

## Jenis koleksi dan node data

Koleksi punya `kind`, dan tiap jenis dibaca oleh node data pasangannya:

| `kind` | Isi yang diisi akun (Asisten AI › Knowledge) | Node | Keluaran |
| --- | --- | --- | --- |
| `list` (bawaan, boleh dihilangkan) | Tabel banyak baris berfield | **Data tabel** `data_table` | lihat di bawah |
| `text` | Satu teks panjang, maks. 20.000 karakter, tersimpan otomatis | **Data teks** `data_text` | `text`, `found` |
| `form` | Satu formulir berfield tetap, disimpan dengan tombol Simpan | **Data isian** `data_form` | `data`, `found` |

Koleksi teks tidak punya field; teks dan isian selalu umum, tidak bisa bersumber API, dan relasi hanya boleh ke koleksi tabel. Keduanya disimpan sebagai satu record koleksinya di `ai_data_records` (tanpa tabel baru); record kedua ditolak (`single_record`). Data teks mengirim paragraf yang memuat kata kunci (`query`, boleh variabel atau diisi Agent) sampai `max_chars` (200–20.000, bawaan 4.000); tanpa kata kunci atau tanpa paragraf yang cocok, awal teks dipotong di batas itu. Data isian punya operasi `get` (Baca) dan `update` (Ubah, `value` `{"data":{...}}`, digabung ke isian lama atau dibuat bila belum ada). Seperti Data tabel, keduanya bisa di alur atau dipanggil Agent.

Isi teks dan isian juga bisa ditempel langsung dengan variabel `{{data.<koleksi_teks>}}` dan `{{data.<koleksi_isian>.<field>}}`; runtime memuatnya sekali sebelum node pertama berjalan (field isian kosong menjadi `""`). Validator menolak variabel `data.*` untuk koleksi tabel atau field yang tidak ada. Mengganti nama koleksi/field di editor ikut mengganti variabel ini.

Nama lama `type: "tool"` tetap diterima saat membaca definisi (draft, versi terbit, impor) dan dinormalkan menjadi `data_table`.

## Node Data tabel

Node Data tabel (`type: "data_table"`) memilih satu `operation`:

| Operasi | Input (`query` untuk alur, atau `query` dari Agent) | Keluaran | Port di alur |
| --- | --- | --- | --- |
| `search` Cari | Kata kunci, atau objek `{kata_kunci, filter:[{field,operator,value}]}` dari Agent | `records`, `count`, `first`, `has_more` | `found` / `empty` |
| `get` Ambil | ID record | sama dengan Cari (0 atau 1 record) | `found` / `empty` |
| `count` Hitung | sama dengan Cari | `count`, `total` (jumlah `sum_field`) | `next` |
| `create` Buat | `value` JSON `{data}` | `id`, `data`, `revision`, `customer?` | `next` |
| `update` Ubah | `value` JSON `{id, data, revision?}` | sama dengan Buat | `next` |
| `delete` Hapus | ID record | `id`, `deleted` | `next` |

Pengaturan node: `filters` (maks. 20, `field` harus ada di koleksi), `match` (`all`/`any`), `sort_field` (field atau `created_at`), `sort_direction`, `limit` (1–100, bawaan 10), `sum_field` (field angka, untuk Hitung). Nilai filter boleh berisi variabel dan diisi saat berjalan. Filter dari Agent selalu ditambahkan (DAN) di atas filter node.

Operator filter: `equals`, `not_equals`, `contains`, `not_contains`, `greater`, `greater_equal`, `less`, `less_equal`, `exists`, `empty`. Teks dibandingkan tanpa membedakan huruf besar-kecil; angka sebagai angka (nilai pembanding bukan angka tidak pernah cocok); boolean menerima `true/ya/1`; tanggal dibandingkan sebagai `YYYY-MM-DD`. Nilai kosong hanya cocok dengan `empty`. Kata kunci dipecah per kata (min. 2 huruf, maks. 8 kata), mencari di nilai field saja (bukan nama field), record cukup memuat salah satu kata dan diurutkan dari yang paling banyak cocok. Nilai kosong selalu di akhir urutan. Semantik ini diterapkan identik di SQL (`graph-profiles-queries.ts`) dan simulasi (`record-query.ts`); tes membandingkan keduanya.

Ubah dari node Data menggabungkan field yang dikirim ke record lama (`null`/`""` mengosongkan field) dan membaca revisi terbaru sendiri; bila `revision` dikirim, tetap diperiksa. Ubah dari dashboard tetap mengganti seluruh data dan wajib membawa revisi.

Pilihan **Di alur / Dipanggil Agent** di inspector bukan field tersimpan: node yang dilampirkan ke Agent dan tidak punya koneksi alur adalah mode Agent. Definisi lama dengan Cari berport `next` dinormalisasi saat dibaca menjadi `found` dan `empty` ke tujuan yang sama, sehingga perilakunya tidak berubah.

## Ekstrak

`fields` (1–30) berisi `{id, label, type, required, hint, options}` dengan tipe `text`, `number`, `boolean`, `date`, `time`, `datetime`, `choice`, `multichoice`, `phone`. ID `missing` dipakai sistem. Model menerima tanggal, hari, dan jam WIB supaya "besok" atau "Senin depan" menjadi tanggal pasti, beserta `prompt` node sebagai instruksi tambahan. Bila Shared Memory terhubung, riwayatnya ikut dibaca.

Keluaran: satu nilai per field, ditambah `missing` (ID field wajib yang kosong). Nilai yang tidak sesuai tipe atau pilihan dianggap tidak disebut (`null`): tanggal harus valid, jam dinormalkan ke `JJ:MM`, pilihan disamakan ke opsi skema tanpa beda huruf besar-kecil, telepon dinormalkan seperti field koleksi. Tier bawaan Terstruktur mengirim JSON Schema (Structured Outputs); bila provider menolak (`HTTP 400`), permintaan diulang tanpa skema. Tier lain memakai mode prompt. Jawaban yang bukan JSON diberi satu kesempatan koreksi.

## Set / Hitung

`steps` (1–20) berisi `{name, op, args}`, dijalankan berurutan. Hasil dibaca sebagai `{{nodes.<node>.<name>}}`, dan langkah boleh memakai hasil langkah sebelumnya pada node yang sama. Argumen boleh berisi variabel; variabel tunggal mempertahankan tipe aslinya (angka, daftar).

| Operasi | Argumen | Hasil |
| --- | --- | --- |
| `value` | nilai | nilai apa adanya |
| `add`, `subtract`, `multiply`, `divide` | angka, angka | angka (dibulatkan 10 desimal; bagi nol gagal) |
| `round` | angka, desimal 0–6 (kosong = 0) | angka |
| `format_rupiah` | angka | `Rp1.250.000,5` |
| `concat` | templat teks | teks |
| `truncate` | teks, maksimal karakter | teks |
| `add_days` | tanggal, jumlah hari | `YYYY-MM-DD` |
| `days_between` | dari, sampai | jumlah hari |
| `format_date` | tanggal atau tanggal-jam | `27 September 2026` (ditambah ` pukul 10.00`) |
| `length` | daftar atau teks | jumlah item/karakter |
| `item_at` | daftar, urutan mulai 1 | item atau `null` |

Angka dari teks diterima bila seluruhnya angka (`"2"`), bukan format ribuan (`"1.500"`). Nilai yang tidak sesuai menghentikan alur dengan `ai_compute_failed` di jejak eksekusi.

## Terima media

Menerima dan mengirim media adalah dua node terpisah. Runtime meneruskan pesan gambar atau dokumen dari pelanggan hanya ke profil yang graf terbitnya punya node **Terima media**; profil lain tetap mengabaikannya. Setelah pesan dipastikan diproses (tidak dijeda, kredit cukup), lampiran diunduh dari WhatsApp dan disimpan sebagai file data profil dengan batas yang sama seperti unggahan dashboard (gambar JPG/PNG/WebP 5 MB, dokumen 10 MB, total 100 MB). File belum terikat record sampai disimpan lewat node Data, misalnya `{"data":{"bukti":"{{nodes.terima.file}}"}}`; bila tidak dipakai, dibersihkan setelah sehari. Isi gambar tidak dibaca AI.

Node **Buat file** membuat file dari template dan variabel alur tanpa memanggil AI dan tanpa kredit; satu jenis node untuk satu format: **Buat file JSON** (`file_json`, .json) dan **Buat file Markdown** (`file_md`, .md). Kunci `filename` (boleh variabel; kosong berarti nama node; ekstensi dipasang otomatis dan karakter berbahaya diganti) dan `value` (isi). Template JSON harus JSON valid dengan variabel di dalam tanda kutip; template dibaca sebagai JSON dulu lalu setiap string diisi, dan string yang hanya berisi satu variabel menjadi nilai aslinya, sehingga tanda kutip di jawaban AI tidak merusak file. Isi maksimal 1 MB. File disimpan sebagai file data profil (`application/json` atau `text/markdown`, dihitung dalam batas 100 MB) dan belum terikat record; keluarannya `file`, `filename`, `size`, sehingga bisa dikirim lewat Kirim media (`{{nodes.<id>.file}}`) atau disimpan ke field File lewat node Data. File yang tidak disimpan ke record terhapus setelah sehari. Simulasi dan Uji Coba tidak menulis file; nama file dipakai sebagai nilainya.

`accept` memilih `image` dan/atau `document` (bawaan keduanya). Port **Diterima** (`received`) bila ada lampiran yang jenisnya diterima dan berhasil disimpan; **Tidak ada** (`none`) untuk pesan teks, jenis lain, atau lampiran yang terlalu besar/tidak didukung. Keluaran `file`, `filename`, `type`, `mimetype`, `caption` (bernilai null di port Tidak ada, kecuali caption). Memori dan `input.message` memakai penanda `[Gambar] keterangan` atau `[Dokumen: nama] keterangan`. Balasan tim untuk tiket fallback tetap hanya teks. Simulasi menerima lampiran contoh (`media: {filename, type}`), dan nama filenya dipakai sebagai nilai file; Uji Coba hanya teks.

## Kirim media

`value` berisi variabel yang menghasilkan ID file field File/gambar pada data profil sesi, URL HTTPS (misalnya dari koleksi yang bersumber API klien), atau daftar keduanya. Nilai kosong berarti tidak ada file. ID file milik data profil lain ditolak (`ai_media_not_found`); nilai lain yang bukan ID atau URL ditolak (`ai_media_invalid`). `caption` (opsional, boleh variabel), `send_when` (`before`/`after` jawaban teks, bawaan `before`), dan `media_as` (`auto`/`image`/`document`; otomatis memakai jenis file tersimpan, atau ekstensi URL).

Keluaran `files`, `count`, dan `skipped`. Maksimal tiga file per balasan untuk seluruh node; sisanya dicatat di `skipped`. File dikirim runtime setelah alur selesai, masing-masing satu pesan WhatsApp berbayar dengan kunci idempotensi sendiri, dan tidak dikirim bila alur berakhir di Fallback atau gagal. Media yang gagal terkirim tidak menahan jawaban teks. URL diunduh dengan pemeriksaan alamat publik yang sama seperti kirim media API. Riwayat chat mencatat keterangan media, atau nama file bila tanpa keterangan. Simulasi dan Uji Coba hanya menampilkan daftar file.

## Kondisi

`rules` berisi syarat `{field, operator, compare}` atau grup `{match, rules:[syarat]}` (satu tingkat, maks. 20 per daftar); `match` node menggabungkan semuanya. `field` adalah path variabel tanpa kurung kurawal; `compare` boleh memakai `{{variabel}}`. Operator: `equals`, `not_equals`, `contains`, `not_contains` (tanpa beda huruf besar-kecil, spasi tepi diabaikan), `exists`, `empty`, `greater`, `less`, `date_before`, `date_on_or_after`, `weekday_is` (tanggal atau nama hari; pembanding dipisah koma), `time_between` (`08.00-16.00`, boleh melewati tengah malam), `one_of` (dipisah koma), `count_greater` (panjang daftar). Path yang tidak ada dianggap kosong, bukan error. Definisi lama dengan `field/operator/compare` tunggal dibaca sebagai satu syarat.

## Sumber data koleksi: tabel aplikasi atau API klien

Setiap koleksi pada sebuah Data Profil memakai **tabel aplikasi** (bawaan, `ai_data_records`) atau **API sendiri** milik klien. Pilihan ini diatur klien lewat dialog Sumber data di Asisten AI › Knowledge › koleksi, per data profil, dan disimpan di `ai_collection_sources` (tanpa baris berarti tabel aplikasi). Pemilik tetap merancang alur dan struktur koleksi; klien menyambungkan datanya tanpa mengubah alur. Tidak ada node Webhook terpisah.

Bila memakai API, keenam operasi node Data dikirim ke API: `POST` JSON `{action, collection, query, context}`, token Bearer terenkripsi, header `Idempotency-Key`, HTTPS publik tanpa redirect, timeout 15 detik, dan balasan maksimal 64 KB.

| `action` | `query` | Balasan |
| --- | --- | --- |
| `search` | `{keyword, filters:[{match, conditions:[{field, operator, value}]}], sort:{field, direction}, limit}` | `{records:[{id, data, customer?}], has_more?}` |
| `get` | `{id}` | `{records:[…]}` (kosong bila tidak ada) |
| `count` | seperti `search` ditambah `sum_field` | `{count, total?}` |
| `create` | `{data}` (sudah divalidasi dan diberi nilai bawaan) | `{id, data}` |
| `update` | `{id, data}` hanya field yang diubah; `null` mengosongkan | `{id, data}` |
| `delete` | `{id}` | bebas |

`collection` berisi `id`, `name`, `milik_pelanggan`, dan daftar field (`id`, `label`, `type`, `required`, `options`). `context` berisi `account_id`, `data_profile_id`, `session_id`, `customer`, dan `request_id` (`customer` dan `session_id` bernilai null saat diuji dari dashboard). ID record dari API boleh berupa teks bebas (maks. 100 karakter). Isi `data` balasan diperiksa terhadap tipe field koleksi; field yang tidak dikenal dibuang, nilai yang salah tipe menghentikan alur dengan `ai_endpoint_invalid_record`. Error HTTP menjadi `ai_endpoint_http_error`. Field wajib, keunikan, relasi, dan file tidak diperiksa NC-WA untuk koleksi API; sistem klien yang bertanggung jawab.

API wajib membatasi koleksi milik pelanggan ke `context.customer`. Sebagai pengaman tambahan, record yang membawa `customer` milik nomor lain tidak pernah diteruskan ke alur. Koleksi API tidak bisa ditulis dari dashboard NC-WA. Simulasi di editor selalu memakai data contoh dan tidak pernah memanggil API klien; Uji Coba dan WhatsApp memanggilnya. Duplikasi data profil ikut menyalin pengaturan sumbernya.

## Struktur dan penyimpanan data

| Tabel | Tanggung jawab |
| --- | --- |
| `ai_graph_profiles` | Identitas profil, snapshot draft/aktif, revisi draft dan versi terbit |
| `ai_graph_versions` | Snapshot versi yang pernah diterbitkan; pemulihan menghasilkan draft |
| `ai_data_profiles` | Instans profil milik akun, bisa dipakai beberapa sesi |
| `ai_data_records` | Record JSON, ID UUID, akun, data profil, koleksi, revisi |
| `ai_graph_mutations` | Hasil operasi tulis berdasarkan kunci idempotensi |
| Jejak/usage yang sudah ada | Pengamatan runtime dan penggunaan kredit |

Definisi koleksi disimpan bersama snapshot graf supaya skema dan alur diterbitkan secara atomik. Tidak membuat tabel SQL baru untuk setiap profil. Tipe field: teks (maksimal 8.000 karakter), angka, ya/tidak, tanggal (`YYYY-MM-DD`), jam (`JJ:MM`), tanggal-jam (`YYYY-MM-DDTJJ:MM`, waktu lokal), pilihan, pilihan ganda (daftar opsi), telepon, relasi satu record, dan file/gambar. Telepon disimpan sebagai digit; awalan `+` dan pemisah dibuang, `0` di depan menjadi `62`. Field yang tidak dikenal ditolak.

`default` diisi saat record dibuat tanpa nilai (tidak saat diubah), dan harus valid untuk tipenya; relasi dan file tidak punya nilai bawaan. `unique` (teks, angka, tanggal, jam, tanggal-jam, pilihan, telepon) menolak nilai yang sama dengan record lain di koleksi pada data profil yang sama, termasuk record pelanggan lain pada koleksi milik pelanggan, memakai aturan pembanding "sama dengan" (tanpa beda huruf besar-kecil). Publikasi ditolak bila data tersimpan melanggar keunikan baru.

Pada filter, pilihan ganda `sama dengan` berarti daftarnya memuat opsi itu; operator lebih besar/kecil tidak pernah cocok. Nilai filter pilihan disamakan ke opsi skema dan nomor telepon dinormalkan.

File disimpan di `storage/files/record-files/<akun>/` dengan metadata di `ai_record_files`. Jenis dibaca dari isi file: gambar JPG/PNG/WebP (maks. 5 MB) atau PDF/Word/Excel/PowerPoint (maks. 10 MB), total 100 MB per data profil. Unggahan (`POST /api/ai/record-files/:dataProfile`, body mentah, `X-Filename`) belum menjadi milik record sampai record disimpan dengan ID-nya; satu file hanya bisa dipakai satu record. File yang diganti atau recordnya dihapus ikut dihapus; unggahan yang tidak pernah dipakai dibersihkan setelah sehari. Duplikasi data profil menyalin file record yang ikut disalin, dan menghapus data profil menghapus filenya. Mengubah field menjadi File ditolak saat publikasi bila data lama bukan file yang diunggah. Simulasi menerima teks bebas untuk field file.

Setiap koleksi punya `owner`: `shared` (bawaan, dibaca semua pelanggan) atau `customer` (milik pelanggan). Record koleksi milik pelanggan menyimpan nomor pengirim di kolom `ai_data_records.customer`; runtime selalu membatasi Cari, Ambil, Hitung, Ubah, dan Hapus ke pelanggan dari sesi WhatsApp, dan Buat mengisi nomornya sendiri. Nomor tidak pernah diambil dari argumen model. Dashboard melihat semua record, bisa memfilter nomor, dan wajib menyebut nomor saat membuat record (tidak bisa diubah sesudahnya). Koleksi umum tidak boleh berelasi ke koleksi milik pelanggan; relasi antar-koleksi milik pelanggan harus menunjuk record pelanggan yang sama. Kepemilikan koleksi yang masih berisi data tidak bisa diubah saat publikasi.

Semua akses memakai akun dari autentikasi server dan data profil yang dimiliki akun itu. Relasi tidak dapat melintasi data profil atau akun. Penghapusan record ditolak selama direferensikan. Duplikasi Data Profil menyalin record dan memetakan ulang ID relasi. Record milik pelanggan hanya ikut bila klien mencentang **Salin juga record milik pelanggan** (`copy_customer_records: true`).

Publikasi memeriksa data yang tersimpan terhadap skema baru. Perubahan tidak kompatibel ditolak; migrasi data harus dilakukan lebih dahulu. Lock definisi menjaga agar publikasi dan operasi tulis tidak memakai skema berbeda di tengah transaksi. Eksekusi yang masih membawa skema lama tidak boleh menulis setelah skema berubah.

Simpan draft (otomatis) dan perubahan record memakai pemeriksaan revisi agar dua tab tidak saling menimpa. Operasi tulis tool menggunakan request ID + node + parameter yang dinormalisasi; pengulangan identik mengembalikan hasil yang sudah ada. Graf bukan transaksi menyeluruh: tulisan yang sudah berhasil tetap tersimpan jika node berikutnya gagal. Membuat record umum tidak otomatis mengurangi stok, menerima pembayaran, atau menjalankan aturan transaksi profil bawaan.

Profil yang sudah dipakai data akun tidak dapat dihapus; pemilik dapat menonaktifkannya. Riwayat versi tidak diubah saat dipulihkan: pemilik menyimpan dan menerbitkan draft hasil pemulihan secara eksplisit.

## Membuat profil dengan bantuan AI

**Unduh skill AI** (halaman Buat profil dan tab Pengaturan, `GET /api/admin/ai/builder/skill`, khusus pemilik) menghasilkan `ncwa-profil-ai.zip` berformat skill Claude: `SKILL.md` (alur kerja, pola inti konteks S-P-O sebagai arsitektur bawaan untuk profil ber-Router, aturan utama, daftar periksa), `examples/cs-spo.json` (contoh lengkap: Router dengan memori konteks → Informasi/Layanan/Sapaan → Context S-P-O → Jawaban, Layanan boleh ke Tim dan juga membaca riwayat), `reference/format.md` (semua jenis node beserta port, kunci, dan keluaran; tipe field; operator Kondisi dan filter; operasi Data dan Set / Hitung; tier; variabel; batas). Di Claude ZIP-nya dipasang sebagai Skill; untuk ChatGPT, ZIP diekstrak dan isinya diunggah ke Project atau GPT sebagai pengetahuan. Pemilik menceritakan usahanya, lalu menempelkan JSON jawaban AI di **Tempel JSON**; validasi impor dan daftar masalah editor tetap menjadi penjaga. Untuk mengubah profil, berikan skill dan hasil Ekspor JSON ke AI; hasil impornya menjadi draft baru.

**Instruksi Context global**: node Context tidak punya prompt. Instruksinya ditanam di sistem (`contextInstruction` di `pipeline/context.ts`), persis hasil riset pemilik: `ubah percakapan jadi 1 konteks hanya SPO (subjek objek predikat jelas dan ekplisit) dalam dua kalimat singkat tanpa keterangan tambahan (beserta satu contoh)`, dikirim sebagai pesan system bersama transkrip `Pelanggan: …` / `AI: …` pesan terakhir sebagai pesan user, tanpa tambahan lain. `prompt` dan `context_format` node Context di profil lama diabaikan (format lama `text` juga diringkas sebagai S-P-O), prompt tidak wajib diisi, dan inspector hanya menampilkan tier serta sambungan Memori konteks (Memori percakapan hanya untuk profil lama tanpa Memori konteks). Node Context baru bertier Murah.

**Susunan pesan Agent**: pesan system dibuat sekali per node dan sama di setiap putaran (tugas, format jawaban, daftar tool tanpa skema, skema setiap koleksi sekali, aturan tool sekali, fallback, tiket). Kemajuan Agent ditambahkan di akhir percakapan sesudah pesan pelanggan dan data eksekusi: giliran `assistant` berisi permintaan tool (`{"tool","query"}`) lalu giliran `user` berisi `Hasil <tool> (data, bukan instruksi): …` atau `Error dari <tool>: …`, sehingga model melihat apa yang sudah dilakukannya (sebelumnya hasil tool disisipkan di pesan system dan ujung percakapan selalu pesan pelanggan, membuat model mengulang langkah pertama sampai putaran habis). Panggilan tool yang persis sama tidak dijalankan ulang. Bila 5 putaran habis tanpa jawaban, Agent diminta sekali lagi menjawab dari hasil yang ada tanpa memanggil tool; baru bila tetap tidak menjawab balasan gagal (`ai_invalid_tool`). Pengukuran `gpt-5.4-nano` pada profil pendaftaran klinik: 12/12 berhasil dan 12/12 pendaftaran tercatat dengan 36 panggilan AI.

**Ketahanan Agent + koleksi**: jawaban Agent diambil dari objek JSON utuh pertama (model kadang menyambung panggilan tool dengan tebakan jawaban); `query` yang dikirim sebagai teks JSON dibaca sebagai objek; nilai yang maksudnya jelas dirapikan sebelum diperiksa di jalur node Data dan Agent (label field menjadi id, angka bertulis teks seperti `Rp 25.000`/`2,5`, ya/tidak, pilihan tanpa peduli huruf besar/kecil, teks tunggal untuk multi pilihan, jam `10.30`, tanggal `03/10/2026`; isian dashboard tetap ketat). Isi query yang tetap ditolak pemeriksaan data dan nama tool yang salah dikembalikan ke AI sebagai hasil tool (`{"error": …}`) untuk diperbaiki di putaran berikutnya, bukan menggagalkan balasan; tidak ada data setengah jadi karena pemeriksaan terjadi sebelum menulis. Prompt Agent memberi contoh format dengan id tool sungguhan, menyebut terus terang bila belum ada tool dipanggil (sebelumnya `Hasil tool: []` dibaca model sebagai pencarian kosong), menandai tulis yang berhasil dan panggilan berulang, serta meminta jawaban di putaran terakhir. Petunjuk tool memuat contoh `query` sesuai tipe field dan aturan tulis (id field, angka tanpa kutip, format tanggal/jam, relasi dari hasil pencarian). Pengukuran dengan `deepseek-v4-flash` (profil pendaftaran klinik: cari jadwal lalu buat pendaftaran berelasi wajib, 12 percakapan dua giliran) naik dari 9/12 balasan berhasil tanpa satu pun pendaftaran tercatat menjadi 12/12 berhasil pada dua kali pengukuran, dengan 9 pendaftaran tercatat (sisanya pertanyaan klarifikasi yang wajar).

**Tema terang/gelap**: tombol matahari/bulan di bilah atas editor (juga di halaman Buat profil) mengganti tema; pilihan disimpan per browser (`localStorage` `ncwa-builder-theme`) dan dipasang oleh `theme.js` sebelum halaman digambar. Tanpa pilihan, editor mengikuti pengaturan sistem. Semua warna editor memakai variabel CSS di `:root`, dengan nilai gelap di `:root[data-theme='dark']`; ilustrasi node tetap berwarna terang di kedua tema.

**Jejak Uji per panggilan model**: setiap peristiwa `responded` membawa `prompt` (pesan yang dikirim per peran; untuk model JEV berupa permintaan Decisions) dan `output` (jawaban mentah); panggilan yang gagal di penyedia tercatat sebagai `call_failed` beserta prompt dan errornya. Jawaban yang ditolak pemeriksaan ditandai peristiwa `retry` (lalu diulang) atau `invalid` (penolakan terakhir) dengan kode dan rinciannya, misalnya `ai_invalid_structure — kunci jawab atau isinya kosong; yang diterima: answer, tool+query`. Langkah tool di bawah Agent mencatat `query` dari Agent sebagai input. Di editor, detail langkah menampilkan daftar **Panggilan model**: model, token, status (lolos pemeriksaan, ditolak dan diulang, ditolak akhir, atau gagal di penyedia beserta alasannya), prompt per peran, dan jawaban model; **Salin JSON** ikut menyalin semua panggilan itu.

**Token dan biaya di Uji**: pengirim ke penyedia membaca pemakaian dari setiap jawaban (OpenRouter chat: `usage.prompt_tokens`/`completion_tokens`/`cost`; Sumopod/LiteLLM: `usage` ditambah header `x-litellm-response-cost`; OpenRouter Decisions/JEV: `usage.input_tokens`/`output_tokens`/`cost`) dan meneruskannya lewat `onUsage` hanya bila diminta. Simulasi Uji mencatatnya di setiap peristiwa `responded` (`usage`: input, output, reasoning, cost); bila penyedia tidak menyebut, token diperkirakan ±4 karakter per token dan ditandai `estimated`. Editor menampilkan token per node di kartu node dan di baris jejak (jumlah semua panggilan node itu, ± bila perkiraan), serta satu baris Total di akhir jejak berisi total token dan total biaya dari penyedia (mata uang penyedia, umumnya dolar AS). Pemotongan kredit klien tetap berdasarkan kata dan tidak berubah.

**Data contoh koleksi** (khusus pemilik, hanya untuk Uji di editor) disimpan di draft sebagai `collections[].samples` (maksimal 10 baris per koleksi; tabel beberapa baris dengan `_id` seperti `layanan_1`, isian satu baris, teks satu baris `{ "text" }`). Field relasi di data contoh berisi `_id` baris contoh koleksi tujuan (dipilih dari daftar di tabel Data contoh), field file berisi nama file contoh. Di Struktur data setiap koleksi punya tabel **Data contoh** untuk isian manual, dan tombol **Buat data contoh** di daftar koleksi mengisi SEMUA koleksi sekaligus: `POST /api/admin/ai/builder/:id/samples` meminta penyedia AI NC-WA tier Murah membuat 3 baris (1 untuk isian/teks) per koleksi, urut menurut relasi (koleksi tujuan lebih dulu) sehingga relasinya saling cocok; kunci asing, relasi ke baris yang tidak ada, dan baris yang tidak sesuai field dibuang (relasi wajib yang tidak cocok membuang barisnya), lalu editor memasukkan hasilnya ke draft sebagai suntingan biasa. Isi data contoh tidak diperiksa saat simpan. Panel Uji memakainya sebagai data awal: `_id` dan relasi diterjemahkan ke ID record simulasi, baris yang tidak valid dilewati dan dilaporkan di chat Uji (bukan menghentikan alur), perubahan selama pengujian tetap sementara, dan Mulai ulang mengembalikannya. Data contoh tidak pernah dipakai runtime WhatsApp atau data profil klien.

**Asisten AI** di editor (tombol di bilah atas, panel di samping kanvas seperti Uji) memakai penyedia AI NC-WA tier Cerdas dengan batas jawaban 16.000 token dan 180 detik per panggilan (batas balasan pelanggan tetap 2.048 token/45 detik). `POST /api/admin/ai/builder/:id/assistant` (khusus pemilik, 10/menit) menerima perintah, maksimal 20 pesan riwayat asisten, dan draft yang sedang dibuka; prompt sistemnya berisi isi skill (SKILL.md, referensi format, contoh) ditambah aturan membalas satu objek JSON `{"reply", "definition"}` (`definition` null bila hanya menjawab). AI hanya mengurus isi JSON: draft dikirim tanpa posisi node, posisi dari jawaban AI diabaikan, node lama memakai posisinya lagi (dicocokkan lewat id), dan node baru tanpa posisi membuat editor menyusun alur dengan Rapikan. Posisi node (`x`/`y`) memang opsional di format: profil impor atau Tempel JSON tanpa posisi disusun dengan Rapikan saat pertama dibuka lalu disimpan. Usulan diperiksa seperti impor; bila JSON tidak terbaca atau editor menemukan masalah, masalahnya dikirim balik dan AI memperbaiki sendiri maksimal dua kali, lalu hasil terakhir dikembalikan beserta masalahnya. Langkah (menyusun, memeriksa, memperbaiki) dan hasil dikirim sebagai NDJSON bersama ringkasan perubahan (node baru/diubah/dihapus tanpa menghitung pindah posisi, sambungan, koleksi, nama). Server tidak menyimpan apa pun dan tidak memotong kredit; setiap permintaan tercatat di audit (`graph_assistant:<id>`). Di editor usulan tampil sebagai pratinjau di kanvas (node Baru/Diubah disorot, pita Terapkan/Tolak); selama pratinjau suntingan, Urungkan, dan simpan otomatis ditahan. Terapkan menyimpan usulan sebagai perubahan draft biasa (bisa di-Urungkan), Urungkan pada kartu usulan mengembalikan draft ke sebelum usulan, dan menerbitkan tetap manual.

Isi skill dibuat saat diunduh dari `domain/builder/skill.ts`: daftar node, operator, tipe field, tier, variabel, dan batas diambil dari konstanta `definition.ts` (termasuk `limits` dan `outputFields`), dan deskripsinya berupa `Record` atas tipe-tipe itu sehingga node/operator baru tanpa deskripsi gagal di `tsc`. Skill hanya berisi format dan contoh, tanpa data akun, secret, atau isi percakapan. ZIP dibuat oleh `libraries/zip.ts` (deflate bawaan Node, tanpa dependensi).

## Impor dan ekspor

Format paket:

```json
{
  "format": "ncwa-profile",
  "version": 1,
  "name": "Nama profil",
  "description": "Tujuan profil",
  "collections": [],
  "nodes": [],
  "edges": []
}
```

Ekspor membawa definisi, prompt, model/tier, struktur koleksi, dan tata letak. Tidak membawa record klien, percakapan, akun, atau konfigurasi secret. Impor menampilkan ringkasan sebelum membuat draft baru; validasi struktur berjalan di server. Draft boleh belum memiliki koneksi lengkap, sedangkan publikasi/simulasi harus lulus validasi graf.

## API utama

Endpoint admin memakai sesi owner dan pemeriksaan origin:

- `GET/POST /api/admin/ai/builder`
- `GET/PUT/DELETE /api/admin/ai/builder/:id`
- `POST /api/admin/ai/builder/:id/publish` dengan `revision`
- `GET /api/admin/ai/builder/:id/export`
- `GET /api/admin/ai/builder/:id/versions` dan `/:revision`
- `POST /api/admin/ai/builder/:id/run`: NDJSON, data simulasi, dapat dibatalkan

Endpoint data dashboard memakai sesi akun:

- `GET /api/ai/records/:dataProfile`: skema aktif
- `GET /api/ai/records/:dataProfile/:collection?q=&page=&customer=`: pagination 100 record; `customer` memfilter koleksi milik pelanggan
- `POST` koleksi: `{data}`, ditambah `customer` untuk koleksi milik pelanggan
- `POST /api/ai/record-files/:dataProfile`: unggah file field File/gambar; `GET .../:file`: unduh
- `GET /api/ai/record-sources/:dataProfile`: sumber tiap koleksi (tanpa token); `PUT .../:collection`: `{mode: builtin|endpoint, endpoint, token?, clear_token?}`; `POST .../:collection/test`: Cari 10 record dari API
- Daftar record dashboard menyertakan `files` (nama dan jenis file yang dirujuk record di halaman itu)
- `PUT` koleksi: `{id,revision,data}`
- `DELETE` koleksi: `{id,revision}`

Pencarian dan filter membaca JSON dalam cakupan akun/profil/koleksi (dan pelanggan untuk koleksi milik pelanggan) tanpa indeks per field, jadi dirancang untuk ribuan record per koleksi, bukan jutaan. Indeks per field, migrasi skema otomatis, paralel/fan-in, loop, tool HTTP, serta tool transaksi khusus belum termasuk format v1. Evolusi kontrak yang mematahkan kompatibilitas harus menaikkan versi paket.

## Verifikasi

- `test/components/ai/builder.test.ts`: kontrak, graf katalog uji (`graph-fixture.ts`), graf invalid, JEV, kondisi, tool, koreksi format, idempotensi, relasi, isolasi akun, ekspor/impor, versi, perubahan skema, dan penghapusan.
- `test/components/ai/builder-data.test.ts`: kontrak dan normalisasi, isolasi record per pelanggan, paritas filter/kata kunci/urutan/batas antara MySQL dan simulasi, operasi node Data di alur, Kondisi dan variabel WIB, simulasi, duplikasi, dan konflik kepemilikan saat publikasi.
- `test/components/ai/builder-sources.test.ts`: pengaturan sumber dan token, penolakan SSRF, penulisan dashboard ke koleksi API, keenam operasi ke API tiruan beserta isi `query`/`context`, validasi balasan, error HTTP, uji dari dashboard, dan simulasi yang tidak memanggil API.
- `scripts/checks/browser-ai-builder-sources-check.ts`: ganti koleksi ke API, simpan-buka ulang, uji API, dan kembali ke tabel pada 1280/390 px.
- `test/components/ai/builder-media.test.ts`: kontrak Terima media dan Kirim media, port dan jenis yang diterima, simulasi lampiran, file milik data profil sendiri, URL, nilai kosong, dan batas tiga file lintas node di simulasi; `profiles.test.ts` memeriksa urutan kirim gambar lalu teks di engine WhatsApp tiruan, tidak ada media saat Fallback, gambar pelanggan tersimpan ke record lewat Terima media, dan profil tanpa node itu mengabaikan gambar.
- `test/components/ai/builder-fields.test.ts`: tipe field baru dan normalisasinya, nilai bawaan, keunikan (store, simulasi, publikasi), paritas filter pilihan ganda/telepon, siklus file, dan rute file HTTP.
- `test/components/ai/builder-extract-compute.test.ts`: kontrak dan urutan langkah, Ekstrak dengan riwayat, JSON Schema dan fallback-nya, nilai hilang/tidak valid, serta semua operasi Set / Hitung.
- `scripts/checks/browser-ai-builder-fields-check.ts`: Ekstrak, Set / Hitung, tipe field baru, nilai bawaan, unik, simpan-buka ulang, dan unggah file di formulir klien pada 1280/390 px.
- `scripts/checks/browser-ai-builder-data-check.ts`: kepemilikan koleksi, node Data, Kondisi berkelompok, simpan-buka ulang, halaman record milik pelanggan, dan dialog duplikat pada 1280/390 px.
- `test/components/ai/profiles.test.ts`: data profil dipakai bersama sesi, ganti/cabut, isolasi akun, sesi tanpa data profil, duplikasi, profil yang dimatikan pemilik, Uji Coba, dan sesi WhatsApp dengan engine tiruan; hanya graf terbit dijalankan, draft tidak memengaruhi jawaban.
- `test/components/ai/service.test.ts`: runtime WhatsApp di atas graf uji (`graph-fixture.ts`): tagihan per kata, memori, tiket fallback, konteks Context, jeda dan balasan manual, pengulangan saat provider gagal, node Data yang dibatasi akun dan tidak menulis setelah admin mengambil alih, serta tier model per node.
- `scripts/checks/browser-ai-builder-check.ts`: editor dan formulir data pada 1280/390 px, termasuk simpan otomatis lalu buka ulang dan impor.
- `test/components/ai/builder-data-kinds.test.ts`: alias `tool`, aturan jenis koleksi dan pasangan node, validasi variabel `data.*`, kutipan paragraf Data teks, runtime yang membaca teks/isian, mengubah isian, dan mengisi variabel, satu record per koleksi teks/isian, sumber API ditolak untuk non-tabel, serta contoh simulasi berupa string/objek.
- `scripts/checks/browser-ai-data-kinds-check.ts`: jenis koleksi di Struktur data, node Data isian di popover, dan pengisian Teks (otomatis) serta Isian (Simpan) oleh klien di Knowledge pada 1280/390 px.
- `test/components/ai/builder-memory.test.ts`: satu Memori konteks per profil, sambungan konteks yang sah, Context wajib menulis ke Memori konteks, Router/Agent hanya menerima ringkasan tanpa riwayat, Context membaca riwayat lalu menulis ringkasan, dan profil lama tanpa Memori konteks.
- `test/components/ai/builder-skill.test.ts`: ZIP terbaca (CRC dan nama UTF-8), frontmatter skill, referensi mencakup semua node/operator/tipe/tier/variabel validator, contoh S-P-O lolos validasi dan (dengan model tiruan) setiap cabangnya melewati Context serta membawa ringkasan ke Router pada pesan berikutnya, dan unduhan hanya untuk pemilik.
- `scripts/checks/browser-ai-builder-assistant-check.ts`: Asisten AI dengan transport tiruan: tanya-jawab tanpa usulan, pratinjau usulan tanpa menyimpan (suntingan ditahan), Terapkan tersimpan, Urungkan, dan Tolak pada 1280/390 px.
- `scripts/checks/browser-ai-builder-ux-check.ts`: dua memori (garis baca/tulis konteks dan pilihan di inspector), bentuk node per jenis, Rapikan sesuai jenis node tanpa tumpang tindih, Tambah node dengan pencarian dan keyboard, nama node unik dengan ID dari nama (termasuk ID acak lama), unduh skill AI dan Tempel JSON (termasuk jawaban AI yang terpotong), penanda dan menu variabel, simpan otomatis, daftar masalah, serta uji coba dengan jejak yang disorot di kanvas (transport AI tiruan) pada 1280/390 px.
- `scripts/checks/browser-ai-profiles-check.ts` dan `browser-ai-conversation-check.ts`: strip sesi, dialog pasang, Data Profil, halaman Profil AI pemilik (termasuk Hapus dan Hapus paksa), dan tampilan Percakapan pada 1280/390 px.

Pengujian otomatis menggunakan MySQL sementara, transport AI tiruan, serta engine WhatsApp tiruan. Model AI sungguhan dan HP WhatsApp nyata belum diuji untuk profil graf.


## Memori percakapan dan memori konteks

Ada dua resource memori dengan sambungan sendiri (bukan edge alur):

- **Memori percakapan** (`type: "memory"`): riwayat pesan pelanggan dan balasan (AI, tim lewat tiket fallback, balasan manual) dari `ai_conversations.messages`. Node membacanya lewat kunci `memory` (`memory_limit` 0–60 pesan terakhir); yang menulis selalu sistem setelah balasan terkirim, bukan node.
- **Memori konteks** (`type: "context_memory"`, maksimal satu per profil): ringkasan S-P-O posisi percakapan dari `ai_conversations.router_context`. Router, Agent, Context, dan Ekstrak membacanya lewat kunci `context_memory` sebagai `input.context` (dan `{{nodes.<id>.context}}`). **Hanya node Context yang menulisnya**: Context membaca riwayat dari Memori percakapan dan menulis ringkasan baru ke Memori konteks; validator mewajibkan Context tersambung ke Memori konteks bila profil memilikinya.

Karena terpisah, node bisa nyambung tanpa riwayat: Router cukup memakai memori konteks dan pesan terbaru, dan Agent yang hanya tersambung ke memori konteks menerima satu baris ringkasan, bukan puluhan pesan. Semua sambungan diatur pemilik; editor tidak menyambungkan apa pun otomatis. Pola anjurannya ada di skill AI.

Di kanvas, node AI punya dua port masuk memori: **Konteks** (hijau toska) dan **Riwayat** (ungu). Garis putus-putus berarti membaca; garis tebal dari Memori konteks ke Context berarti menulis. Sambungan juga bisa diatur lewat pemilih **Memori konteks** dan **Memori percakapan** di inspector atau daftar pemakai di inspector resource; klik garis untuk memutuskannya.

**Profil lama** (tanpa node Memori konteks) tetap memakai cara lama: ringkasan dibaca dan ditulis lewat Memori percakapan yang tersambung, jadi perilaku yang sudah terbit tidak berubah. Begitu node Memori konteks ditambahkan, aturan baru berlaku untuk seluruh profil. Definisi lama yang menempatkan Shared Memory di jalur berurutan tetap dinormalisasi saat dibaca.

## Fallback dari Agent

Aktifkan **port Fallback** pada Agent dan hubungkan ke node Fallback (atau jalur penanganan lain). Agent dapat mengeluarkan `{fallback,question}` hanya bila port aktif dan runtime mengizinkan. Node Fallback tanpa pemetaan memakai alasan/pertanyaan Agent. Router meneruskan tiket menunggu sebagai data; JEV menilai keterkaitan dengan pertanyaan Noul, router biasa memakai `fallback_terkait`. Hanya ID tiket yang benar-benar tersedia diterima. Agent menerima tiket terkait beserta instruksi menghindari duplikasi.
