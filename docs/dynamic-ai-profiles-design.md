# Profil AI dinamis

Implementasi berdasarkan diskusi pemilik: editor visual dengan graf bebas, struktur data per profil, impor/ekspor definisi, serta pengujian terpisah dari data klien. Pemilik mengarahkan implementasi langsung di workspace; desain dan keputusan teknis dicatat di sini.

## Menggunakan fitur

1. Buka **Dashboard Admin → Profil AI → Buat profil · Editor alur · Impor JSON**, atau `/dashboard/admin/ai-builder`.
2. Buat profil kosong, gunakan template CS Usaha/Pendidikan/Tester, atau impor paket JSON. Profil baru berstatus draft dan belum aktif untuk klien.
3. Tentukan koleksi pada **Struktur data**. ID koleksi/field menjadi referensi stabil; ubah label untuk mengganti nama tampilan.
4. Susun node dan koneksi pada **Alur**. Klik/tarik palet untuk menambah, tarik header node untuk memindahkan, sambungkan port keluar ke port masuk. Pengaturan node juga menyediakan pemilih tujuan koneksi untuk keyboard/ponsel.
5. Jalankan **Pengujian** dengan pesan dan data contoh. Lihat hasil per node di jejak eksekusi. Data contoh hanya berlaku untuk simulasi.
6. Simpan draft dan periksa masalah pada **Ringkasan**. Terbitkan sesudah diuji. Aktifkan profil melalui daftar **Profil AI** agar bisa dipilih akun.
7. Akun membuat **Data Profil**, memilih profil tersebut, lalu **Kelola isi** untuk mengisi koleksi. Pasang Data Profil ke sesi melalui mekanisme yang sama dengan profil bawaan.

Profil bawaan dan AI Studio lamanya tetap tersedia. Template Katalog sederhana/Pendidikan adalah titik awal dengan koleksi umum. Template CS Usaha lengkap memakai operasi bisnis CS yang tersedia sebagai kemampuan Tool. Tidak ada konversi otomatis data profil lama.

## Node dan kontrak eksekusi

| Node | Perilaku |
| --- | --- |
| Input | Menyediakan `input.message`, `input.context`, dan `input.history` |
| Shared Memory | Resource riwayat untuk Router/Agent/Context yang dihubungkan; batas 0–60 pesan sebelumnya, terisolasi per akun/sesi/pelanggan |
| Router | Memilih satu cabang sesuai kriteria; tier Keputusan mendukung JEV melalui protokol keputusan yang sudah tersedia |
| Agent | Menghasilkan jawaban, atau memakai node Tool data yang diizinkan secara eksplisit |
| Kondisi | Satu atau beberapa syarat (semua/salah satu), boleh dengan grup DAN/ATAU satu tingkat; lihat **Kondisi** |
| Data (tipe `tool`) | Cari, Ambil, Buat, Ubah, Hapus, atau Hitung isi koleksi; atau kemampuan bisnis: knowledge, katalog, pesanan pelanggan, buat pesanan, foto produk |
| Context | Menyimpan ringkasan untuk percakapan berikutnya, maksimal 200 karakter |
| Output | Mengambil teks/variabel sebagai jawaban akhir |
| Fallback | Meneruskan kebutuhan ke mekanisme tiket tim yang sudah ada; memerlukan konfigurasi fallback sesi |

Graf bebas susun, satu jalur dipilih per pesan. Cabang boleh bertemu kembali. Setiap port harus memiliki tepat satu tujuan. Siklus, node tak terjangkau, referensi hilang, dan variabel yang belum tersedia pada seluruh jalur ditolak ketika simulasi/publikasi. Tool yang dilampirkan pada Agent tidak wajib mempunyai koneksi alur.

Batas format: 60 node, 180 koneksi, 30 koleksi, 50 field per koleksi. Runtime membatasi 60 langkah, 20 permintaan model logis, 5 putaran Agent, dan waktu 120 detik. Retry transport tetap dibatasi secara terpisah. Jawaban akhir mengikuti anggaran kata runtime, paling banyak 300 kata/8.000 karakter. Model yang salah format diberi satu kesempatan koreksi pada node Agent.

Variabel memakai `{{input.message}}`, `{{nodes.nama_node.answer}}`, atau variabel runtime `system.today|tomorrow|now|time|weekday` (WIB), `customer.phone|name` (nama profil WhatsApp; kosong di Uji Coba), dan `service.name` (nama data profil). Tidak ada `eval`, skrip pengguna, atau URL tool bebas. Konfigurasi koneksi provider dan secret berada di pengaturan AI server. Model khusus per node opsional; tidak mengubah penyedia/kredensial tier secara otomatis.

## Node Data

Node Data (`type: "tool"` tanpa `capability`) memilih satu `operation`:

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

## Kondisi

`rules` berisi syarat `{field, operator, compare}` atau grup `{match, rules:[syarat]}` (satu tingkat, maks. 20 per daftar); `match` node menggabungkan semuanya. `field` adalah path variabel tanpa kurung kurawal; `compare` boleh memakai `{{variabel}}`. Operator: `equals`, `not_equals`, `contains`, `not_contains` (tanpa beda huruf besar-kecil, spasi tepi diabaikan), `exists`, `empty`, `greater`, `less`, `date_before`, `date_on_or_after`, `weekday_is` (tanggal atau nama hari; pembanding dipisah koma), `time_between` (`08.00-16.00`, boleh melewati tengah malam), `one_of` (dipisah koma), `count_greater` (panjang daftar). Path yang tidak ada dianggap kosong, bukan error. Definisi lama dengan `field/operator/compare` tunggal dibaca sebagai satu syarat.

## Struktur dan penyimpanan data

| Tabel | Tanggung jawab |
| --- | --- |
| `ai_graph_profiles` | Identitas profil, snapshot draft/aktif, revisi draft dan versi terbit |
| `ai_graph_versions` | Snapshot versi yang pernah diterbitkan; pemulihan menghasilkan draft |
| `ai_data_profiles` | Instans profil milik akun, bisa dipakai beberapa sesi |
| `ai_data_records` | Record JSON, ID UUID, akun, data profil, koleksi, revisi |
| `ai_graph_mutations` | Hasil operasi tulis berdasarkan kunci idempotensi |
| Jejak/usage yang sudah ada | Pengamatan runtime dan penggunaan kredit |

Definisi koleksi disimpan bersama snapshot graf supaya skema dan alur diterbitkan secara atomik. Tidak membuat tabel SQL baru untuk setiap profil. Field awal: teks (maksimal 8.000 karakter), angka, boolean, tanggal, pilihan, relasi satu record. Mendukung field wajib, pilihan terbatas, validasi tipe/tanggal, serta penolakan field yang tidak dikenal.

Setiap koleksi punya `owner`: `shared` (bawaan, dibaca semua pelanggan) atau `customer` (milik pelanggan). Record koleksi milik pelanggan menyimpan nomor pengirim di kolom `ai_data_records.customer`; runtime selalu membatasi Cari, Ambil, Hitung, Ubah, dan Hapus ke pelanggan dari sesi WhatsApp, dan Buat mengisi nomornya sendiri. Nomor tidak pernah diambil dari argumen model. Dashboard melihat semua record, bisa memfilter nomor, dan wajib menyebut nomor saat membuat record (tidak bisa diubah sesudahnya). Koleksi umum tidak boleh berelasi ke koleksi milik pelanggan; relasi antar-koleksi milik pelanggan harus menunjuk record pelanggan yang sama. Kepemilikan koleksi yang masih berisi data tidak bisa diubah saat publikasi.

Semua akses memakai akun dari autentikasi server dan data profil yang dimiliki akun itu. Relasi tidak dapat melintasi data profil atau akun. Penghapusan record ditolak selama direferensikan. Duplikasi Data Profil menyalin record dan memetakan ulang ID relasi. Record milik pelanggan hanya ikut bila klien mencentang **Salin juga record milik pelanggan** (`copy_customer_records: true`).

Publikasi memeriksa data yang tersimpan terhadap skema baru. Perubahan tidak kompatibel ditolak; migrasi data harus dilakukan lebih dahulu. Lock definisi menjaga agar publikasi dan operasi tulis tidak memakai skema berbeda di tengah transaksi. Eksekusi yang masih membawa skema lama tidak boleh menulis setelah skema berubah.

Simpan draft dan perubahan record memakai pemeriksaan revisi agar dua tab tidak saling menimpa. Operasi tulis tool menggunakan request ID + node + parameter yang dinormalisasi; pengulangan identik mengembalikan hasil yang sudah ada. Graf bukan transaksi menyeluruh: tulisan yang sudah berhasil tetap tersimpan jika node berikutnya gagal. Membuat record umum tidak otomatis mengurangi stok, menerima pembayaran, atau menjalankan aturan transaksi profil bawaan.

Profil yang sudah dipakai data akun tidak dapat dihapus; pemilik dapat menonaktifkannya. Riwayat versi tidak diubah saat dipulihkan: pemilik menyimpan dan menerbitkan draft hasil pemulihan secara eksplisit.

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
- `PUT` koleksi: `{id,revision,data}`
- `DELETE` koleksi: `{id,revision}`

Pencarian dan filter membaca JSON dalam cakupan akun/profil/koleksi (dan pelanggan untuk koleksi milik pelanggan) tanpa indeks per field, jadi dirancang untuk ribuan record per koleksi, bukan jutaan. Indeks per field, migrasi skema otomatis, paralel/fan-in, loop, tool HTTP, serta tool transaksi khusus belum termasuk format v1. Evolusi kontrak yang mematahkan kompatibilitas harus menaikkan versi paket.

## Verifikasi

- `test/components/ai/builder.test.ts`: kontrak, template, graf invalid, JEV, kondisi, tool, koreksi format, idempotensi, relasi, isolasi akun, ekspor/impor, versi, perubahan skema, dan penghapusan.
- `test/components/ai/builder-data.test.ts`: kontrak dan normalisasi, isolasi record per pelanggan, paritas filter/kata kunci/urutan/batas antara MySQL dan simulasi, operasi node Data di alur, Kondisi dan variabel WIB, simulasi, duplikasi, dan konflik kepemilikan saat publikasi.
- `scripts/checks/browser-ai-builder-data-check.ts`: kepemilikan koleksi, node Data, Kondisi berkelompok, simpan-buka ulang, halaman record milik pelanggan, dan dialog duplikat pada 1280/390 px.
- `test/components/ai/profiles.test.ts`: integrasi sesi WhatsApp dengan engine tiruan; hanya graf terbit dijalankan, draft tidak memengaruhi jawaban.
- `scripts/checks/browser-ai-builder-check.ts`: editor dan formulir data pada 1280/390 px, termasuk simpan lalu buka ulang dan impor.
- Tes profil lama/AI Studio/agent serta pemeriksaan browser profil lama untuk regresi integrasi.

Pengujian otomatis menggunakan MySQL sementara, transport AI tiruan, serta engine WhatsApp tiruan. Model asli telah diuji pada sandbox CS lengkap untuk salam, produk, pesanan, dan foto. HP WhatsApp nyata belum diuji; lihat `cs-builder-parity-report.md`.


## Shared Memory

**Shared Memory** adalah resource dengan koneksi sendiri. Alur eksekusi tetap misalnya Input → Router → Agent → Output. Port ungu Shared Memory dapat dihubungkan ke port **Memori** pada satu atau beberapa Router, Agent, dan Context. Satu node pemakai memilih satu resource; satu resource boleh mempunyai banyak pemakai. Resource yang tidak terhubung boleh tetap berada di kanvas.

Koneksi dapat dipasang/dilepas dengan port, melalui pemilih **Shared Memory** pada inspector pemakai, atau checkbox daftar pemakai pada inspector resource. Klik garis ungu untuk memutuskannya. Node yang dilepas tidak lagi menerima riwayat dan ringkasan secara otomatis; hasil node lain pada jalur eksekusi tetap merupakan data alur. Pemutusan koneksi tidak menghapus riwayat tersimpan.

`memory` pada definisi node menyimpan ID resource, atau string kosong untuk tidak terhubung. Jumlah riwayat pada resource memakai `memory_limit` (0–60 pesan). `{{nodes.shared_memory.history}}` dan `{{nodes.shared_memory.context}}` hanya dapat dibaca node yang terhubung langsung ke resource tersebut. Referensi memori yang belum dihubungkan ditolak saat validasi.

Penyimpanan tetap memakai `ai_conversations.messages` dan `router_context` dengan cakupan akun, sesi WhatsApp, dan pelanggan. Resource membaca percakapan yang sama dengan jendela masing-masing, tanpa memanggil model. Context yang terhubung dapat memperbarui ringkasan; runtime menyimpan riwayat setelah balasan. Batas penyimpanan tetap mengikuti pengaturan memori sesi, sedangkan simulasi menyimpan hingga 60 pesan sementara.

Profil kosong/template baru memiliki sambungan resource bawaan. Definisi lama yang menempatkan Shared Memory di jalur berurutan dinormalisasi ketika dibaca: sambungan alur dilewatkan langsung dan node model sesudahnya mendapat referensi resource. Versi tersimpan tidak ditulis ulang otomatis. Profil tanpa sambungan memori tidak membaca riwayat secara otomatis; pasang resource pada node yang memerlukannya.

## Kemampuan bisnis pada Tool

Node Tool dapat memilih `capability`: `get_knowledge`, `get_products`, `check_order`, `create_order`, atau `send_product_image`. Tanpa capability, kontrak CRUD koleksi tetap berlaku. Nama/ID node bebas; dispatch mengikuti capability dan izin Agent, bukan nama node.

Operasi bisnis memakai tabel bersama yang sudah ada (`ai_products`, `ai_orders`, `ai_product_images`, `ai_data_sources`, dan bidang profil usaha di `ai_data_profiles`), dengan cakupan akun dan data profil. Tidak membuat tabel per profil. Koleksi kustom tetap memakai `ai_data_records`; katalog/pesanan bisnis tidak diduplikasi ke koleksi JSON. Menu isi profil menampilkan usaha, katalog, sumber data, dan pesanan ketika graf memakai kemampuan bisnis.

`check_order` membatasi pelanggan dari konteks server. `create_order` menerima objek item tervalidasi atau teks pesanan. Teks menggunakan parser lebih dahulu, lalu ekstraksi AI dengan tier/model/instruksi node Tool jika diperlukan. Harga, ketersediaan, stok, dan idempotensi mengikuti layanan CS yang sama. Sesuai perilaku CS bawaan, pesanan baru belum mengurangi/memesan stok dan belum berarti pembayaran berhasil.

Runtime meneruskan tool melalui adapter yang sama dengan profil bawaan sehingga pemilihan foto masuk antrean pengiriman setelah jawaban berhasil. Sandbox memiliki adapter terpisah tanpa database, endpoint, atau pengiriman WhatsApp. Isikan `business` dengan `knowledge`, `products`, `orders`, dan `pending` pada pengujian; pelanggan sintetisnya `628000000001`. Hasil bisnis dikembalikan untuk giliran berikutnya.

Aktifkan **port Fallback** pada Agent dan hubungkan ke node Fallback (atau jalur penanganan lain). Agent dapat mengeluarkan `{fallback,question}` hanya bila port aktif dan runtime mengizinkan. Node Fallback tanpa pemetaan memakai alasan/pertanyaan Agent. Router meneruskan tiket menunggu sebagai data; JEV menilai keterkaitan dengan pertanyaan Noul, router biasa memakai `fallback_terkait`. Hanya ID tiket yang benar-benar tersedia diterima. Agent menerima tiket terkait beserta instruksi menghindari duplikasi.
