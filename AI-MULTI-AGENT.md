# Engine AI multi-agent

Engine internal TypeScript di NC-WA SaaS, tanpa n8n. Keputusan client terbaru menggantikan mode demo prototype: Knowledge, Produk/Layanan, Order/Pesanan, dan Perilaku AI adalah konfigurasi per nomor layanan milik tenant.

## Alur dan konfigurasi

WhatsApp → antrean pelanggan → reservasi kredit → router → satu spesialis → tools → jawaban → Context Agent → pengiriman WhatsApp → shared memory + konteks router MySQL.

| Konfigurasi | Sumber | Digunakan oleh |
| --- | --- | --- |
| Knowledge | Teks client | Informasi, Konsultasi, Dukungan, Keluhan |
| Produk/Layanan | Tabel NC-WA, atau custom endpoint | Informasi, Konsultasi, Transaksi |
| Order/Pesanan | Tabel NC-WA, atau custom endpoint | Transaksi, Dukungan, Keluhan |
| Perilaku AI | Teks client | Seluruh agent, termasuk router |
| Shared Memory | Otomatis oleh NC-WA | Delapan spesialis |
| Router Context Memory | S-P-O terbaru dari Context Agent | Router |

Sumber Produk dan Order dipilih secara independen. Semua kombinasi bawaan/custom didukung. Mode demo tidak lagi digunakan; tabel baru tidak diisi data klinik contoh. Knowledge diakses melalui tool, bukan disisipkan ke prompt seluruh agent. Fakta yang pernah dibahas tetap dapat muncul dalam shared memory.

Router dan delapan spesialis ada di `src/ai-agents.ts`. Router membaca pesan terbaru dan konteks S-P-O sebelumnya untuk memahami lanjutan percakapan, lalu menghasilkan `sub_agent`, `s_p_o_konteks` (3 kata), dan `isi_pesan` (pesan terbaru apa adanya). Output klasifikasi tidak masuk memory. Agent pembuka, penutup, dan lainnya tidak mempunyai tools bisnis.

Spesialis menggunakan JSON `{"answer":"..."}` atau `{"tool":"nama","query":"string"}` melalui transport Chat Completions. Izin tool mengikuti tabel konfigurasi di atas: `get_knowledge`, `get_products`, `check_order`, dan `create_order`. Adapter `AIData` di `src/ai-data.ts` menentukan sumber tanpa memperlihatkan penyimpanan atau endpoint kepada model.

Batas satu turn: satu router, satu Context Agent, lima panggilan spesialis, maksimal empat tool, query 2.000 karakter, hasil tool 16.000 karakter. Hasil validasi input tool dapat dikoreksi agent; error jaringan/infrastruktur menggagalkan generasi. Pembuatan order yang sudah berhasil tidak dieksekusi lagi dalam turn yang sama, meskipun model mengubah argumen pemanggilan berikutnya.

Context Agent membaca pesan pelanggan dan jawaban final, lalu menghasilkan satu baris tiga kata `subjek-predikat-objek` (maksimal 200 karakter). Konteks disimpan di `ai_conversations.router_context` hanya setelah pengiriman berhasil dan revision masih sama, terpisah dari riwayat chat. Router menggunakan konteks ini untuk pesan seperti “ya”, “yang itu”, atau “cukup”, dan mengikuti intent baru bila topik berubah. Jika pembaruan konteks gagal/invalid, jawaban tetap dikirim dan konteks lama dikosongkan agar tidak menyesatkan. Takeover manual mengosongkan konteks router; Hapus konteks menghapus kedua memori. Dashboard menampilkan S-P-O terakhir. Migrasi `migrateAI` menambahkan kolom nullable secara idempoten; percakapan lama dimulai tanpa S-P-O.

## Tiga tingkat model (khusus pemilik)

Pengaturan `/dashboard/admin/ai` menyediakan model murah, sedang, dan cerdas dengan endpoint/API key bersama. Router, Context Agent, Pembuka, dan Penutup memakai murah; Informasi, Konsultasi, Transaksi, Dukungan, dan Keluhan memakai sedang; Lainnya memakai cerdas. Pembagian ini tetap berdasarkan peran, tanpa eskalasi atau fallback otomatis saat provider gagal. Tombol tes per tingkat menguji konfigurasi yang sudah disimpan.

Migrasi menambahkan `model_cheap`, `model_medium`, `model_smart` nullable. Nilai yang belum diatur memakai model lama agar migrasi tidak mengganti provider/model aktif. Nama model di prototype tidak otomatis diaktifkan. Pemilik memilih nama model yang tersedia pada providernya. Konfigurasi diambil sekali per turn agar perubahan setting tidak mengganti model di tengah turn.

`ai_usage.model_calls` mencatat peran, model aktual, dan status transport (`responded`/`failed`) setiap panggilan, termasuk pengulangan specialist untuk tools. Status responded bukan jaminan output valid; status permintaan menunjukkan hasil akhir. Kolom model lama menyimpan model specialist saat generasi berhasil. Riwayat ini tersedia hanya di `/api/admin/ai/usage` dan halaman pemilik. API penggunaan client tidak mengirim model atau trace. Tarif kredit client tetap sama; proses routing dan Context Agent tidak ditagihkan tambahan.

## Tabel bawaan dan UI

Di halaman Asisten AI, client dapat:

- Mengisi Knowledge dan Perilaku AI.
- Memilih Tabel NC-WA atau Custom endpoint untuk Produk dan Order masing-masing.
- Menambah/mengubah produk atau layanan: kode, nama, jenis, deskripsi, harga rupiah, stok/kapasitas, dan status aktif. Menonaktifkan produk mengeluarkannya dari katalog agent.
- Membuat pesanan manual dan melihat pesanan dari agent; memperbarui status (`baru`, `diproses`, `selesai`, `dibatalkan`) dan catatan.
- Melihat agent pada riwayat AI serta menjeda/menghapus konteks pelanggan.

Katalog tool menampilkan maksimal 20 hasil dan mendukung pencarian nama/kode. UI menampilkan maksimal 200 produk dan 200 pesanan terbaru. Form manual membuat satu jenis item per pesanan; API/agent mendukung 1–20 jenis item. Harga/nama item disalin dari sumber Produk yang dipilih, bukan dari input harga model/browser. Snapshot tidak berubah ketika produk diedit atau dinonaktifkan.

Order bawaan berstatus awal `baru`: pencatatan permintaan, bukan bukti pembayaran atau komitmen stok. Stok/kapasitas diperiksa saat pencatatan tetapi tidak dikurangi atau direservasi otomatis. Pemilik bisnis meninjau dan memproses pesanan. Produk diarsipkan dengan nonaktif; order dibatalkan melalui status sehingga riwayat dan idempotensi tetap ada.

Saat sumber custom dipilih, agent menggunakan endpoint; tabel NC-WA sebelumnya tetap tersimpan dan tetap dapat dikelola. Pengelolaan data **remote** dilakukan di sistem client. Tombol tambah/edit pada tabel NC-WA selalu mengelola data lokal. Pergantian sumber tidak menyalin atau menyinkronkan data otomatis.

## Isolasi dan idempotensi

Semua konfigurasi, produk, dan order mempunyai scope `(account_id, session_id)`. Memory memakai `(account_id, session_id, customer)`. Gateway memperoleh identitas akun dari autentikasi lalu memeriksa kepemilikan session. Agent hanya dapat membaca order milik pelanggan WhatsApp yang sedang dilayani. UI tenant dapat mengelola seluruh order dalam session miliknya.

Memory bertahan setelah restart. Default instalasi baru 60 pesan (sekitar 30 interaksi); setting lama tetap dipertahankan. Batas global 1–100 pesan dikelola pemilik SaaS. Isi memory hanya pesan pengguna/balasan, termasuk takeover manual; output routing/tool tidak disimpan ke memory.

Pembuatan order bawaan memakai unique request ID per tenant/session, hash payload, transaksi MySQL dan lock akun. Retry input sama mengembalikan order yang sama, termasuk setelah restart/perubahan harga. Payload berbeda dengan key sama ditolak. Order yang telah tersimpan **tidak dibatalkan** jika tahap AI berikutnya atau pengiriman WhatsApp gagal; client dapat meninjau order tersebut di tabel.

Custom endpoint wajib menerapkan idempotensi persisten berdasarkan header `Idempotency-Key`. Key dibuat server, dibatasi tenant/session/customer/request/action; produk read dan order create tetap berbeda meskipun menggunakan URL sama. Tidak ada retry otomatis request yang gagal/ambigu. Client endpoint bertanggung jawab memfilter data sesuai tenant/session/customer dan menerapkan aturan bisnisnya sendiri; NC-WA memeriksa nomor pelanggan dan ID pada hasil baca order.

Token endpoint disimpan terenkripsi dan tidak dikembalikan dalam API/UI. Token kosong mempertahankan token hanya bila URL tetap sama; mengganti URL tanpa token baru menghapus token lama. Memilih bawaan atau mencentang hapus token menghapus token. Semua endpoint wajib HTTPS publik, tanpa userinfo/query/fragmen; DNS dipin pada koneksi, redirect tidak diikuti, timeout 15 detik/request, respons maksimal 32.000 byte. Secret dan body endpoint tidak masuk pesan error.

## Kontrak custom endpoint

Satu URL Produk menangani `get_products`. Satu URL Order menangani `check_order` dan `create_order`. Semua menggunakan HTTP POST JSON, respons HTTP 200 JSON. Header `Authorization: Bearer <token>` dikirim bila token diisi, serta `Idempotency-Key` dari server. Endpoint harus dapat menangani schema berikut; endpoint REST yang berbeda perlu adapter di sisi client.

Contoh permintaan Produk:

```json
{
  "action": "get_products",
  "query": "P-1",
  "context": {
    "account_id": "tenant-id",
    "session_id": "shop",
    "customer": "628123456789",
    "request_id": "incoming-request-id"
  }
}
```

`query` kosong meminta daftar, string lain mencari nama/kode. Kembalikan maksimal 20 produk; pencarian kode harus menyertakan produk dengan kode tersebut. Harga adalah integer rupiah, stok adalah integer nonnegatif, `active` boolean, dan `type` bernilai `product` atau `service`.

```json
{
  "products": [{
    "id": "P-1", "name": "Produk A", "type": "product",
    "description": "Produk harian", "price": 125000, "stock": 10, "active": true
  }]
}
```

Baca pesanan menggunakan context yang sama, `action: "check_order"`, dan `query: "ORD-1"`. Hasil tidak ditemukan adalah `{"order":null}`. Jangan mengembalikan order pelanggan lain.

Agent membuat pesanan dengan query string JSON berisi `items: [{product_id,quantity}]` dan `notes`. Server mengambil nama/harga dari sumber Produk terpilih. Endpoint Order menerima **objek query**, dengan snapshot terverifikasi ini:

```json
{
  "action": "create_order",
  "query": {
    "items": [{"product_id":"P-1","quantity":2,"name":"Produk A","price":125000}],
    "notes": "Tolong siapkan"
  },
  "context": {
    "account_id":"tenant-id", "session_id":"shop",
    "customer":"628123456789", "request_id":"incoming-request-id"
  }
}
```

Hasil create/check sama:

```json
{
  "order": {
    "id":"ORD-1", "customer":"628123456789",
    "items":[{"product_id":"P-1","quantity":2,"name":"Produk A","price":125000}],
    "total":250000, "status":"baru", "notes":"Tolong siapkan"
  }
}
```

`total` wajib sama dengan jumlah harga × quantity. ID maksimal 64 karakter `[A-Za-z0-9_-]`; nama 150 karakter; deskripsi 500; catatan 1.000; quantity 1–1.000. Create wajib mengembalikan items yang sesuai permintaan, customer yang sama, dan order non-null. Endpoint tidak menerima Knowledge, Perilaku AI, memory, atau kredensial penyedia model.

## API tabel NC-WA

Seluruh route mendukung autentikasi gateway yang sudah ada, dan memverifikasi kepemilikan session. Cookie memerlukan Origin yang sesuai untuk perubahan.

| Route | Fungsi |
| --- | --- |
| GET/PUT `/sessions/:id/ai` | Knowledge, behavior, enabled, products_source, orders_source |
| GET `/sessions/:id/ai/products` | Daftar produk lokal |
| PUT `/sessions/:id/ai/products/:code` | Tambah/edit/nonaktifkan produk lokal |
| GET `/sessions/:id/ai/orders` | Daftar order lokal |
| POST `/sessions/:id/ai/orders` | Buat order lokal: customer, items, notes; wajib Idempotency-Key |
| PUT `/sessions/:id/ai/orders/:orderId` | Ubah status dan notes; customer/items/total tidak dapat diubah |

Sumber dalam PUT konfigurasi: `{"mode":"builtin"}` atau `{"mode":"endpoint","endpoint":"https://...","token":"opsional","clear_token":false}`. GET hanya mengembalikan `mode`, `endpoint`, `has_token` untuk masing-masing sumber. Field sumber yang tidak dikirim dipertahankan.

## Migrasi dan verifikasi

`npm run migrate` menambah `ai_data_sources`, `ai_products`, `ai_orders`, serta metadata agent pada usage. Migrasi additive, aman diulang, dan tidak menghapus data lama. Kolom `demo_tools` dari versi prototype, bila sudah ada, tidak lagi dibaca. Jalankan migrasi sebelum runtime baru; `npm run build` menghasilkan `dist`.

Tarif/reservasi lama dipertahankan: input yang ditagihkan adalah instruksi service/perilaku dan memory; output adalah jawaban final. Knowledge/produk/order yang diambil lewat tools, router, Context Agent, dan prompt tambahan merupakan proses internal tanpa potongan tambahan. Jawaban valid yang gagal dikirim tetap mengikuti aturan tagihan AI lama.

Tes: `test/ai-agents.test.ts`, `test/ai-data.test.ts`, `test/ai.test.ts`, suite `npm test`, serta `npm run test:browser` (CHROMIUM_PATH bila perlu). Pengujian mencakup data persisten, kombinasi sumber, tenant/session/customer, endpoint invalid, harga snapshot, idempotensi, takeover, routing/shared memory, dan UI desktop/mobile.

`npx tsx --env-file=.env scripts/test-ai-live.ts` adalah smoke test penyedia berbayar opsional dengan data sintetis dan adapter in-memory, tanpa pengiriman WhatsApp atau order nyata. Uji provider terakhir pada 17 September 2026 tertahan HTTP 401; key perlu diperbarui. Endpoint client nyata dan HP WhatsApp belum diuji; pengujian adapter/WhatsApp memakai transport tiruan.
