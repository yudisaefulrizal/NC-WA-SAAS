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

Batas satu turn: satu tahap router, satu tahap Context Agent, lima langkah spesialis, maksimal empat tool, query 2.000 karakter, hasil tool 16.000 karakter. Tiap respons model yang tidak valid boleh dikoreksi sekali. Kegagalan koneksi, timeout, HTTP 429/5xx dicoba ulang maksimal dua kali dengan jeda 500/1.000 ms ditambah jitter hingga 250 ms. HTTP 401/403/404 dan kesalahan konfigurasi tidak diulang. Total panggilan model dibatasi 20; panggilan baru dihentikan setelah 120 detik (panggilan aktif tetap memakai timeout transport 45 detik). Seluruh percobaan memakai model yang sama dan dicatat dalam `model_calls` dengan nomor attempt transport. Hasil validasi input tool dapat dikoreksi agent. Pembuatan order yang sudah berhasil tidak dieksekusi lagi dalam turn yang sama, meskipun model mengubah argumen pemanggilan berikutnya.

Jika generasi tetap gagal, reservasi kredit AI dikembalikan penuh dan sistem mencoba mengirim satu pesan bantuan. Pesan bantuan menyarankan menghubungi admin serta memeriksa status pesanan sebelum mengulang pemesanan; order yang telah dibuat tidak dihapus. Status `fallback_sent`, `fallback_send_failed`, atau `fallback_send_unknown` menunjukkan hasilnya. Pengiriman bantuan tetap memakai satu kredit WhatsApp; tidak ada retry pengiriman. Pesan bantuan yang terkirim masuk shared memory dan mengosongkan konteks router. Pause, perubahan konfigurasi, hapus konteks, dan takeover manual membatalkan percobaan berikutnya serta pengiriman bantuan melalui pemeriksaan revision. Kegagalan Context Agent setelah retry tetap mengirim jawaban specialist yang valid.

Mode `full_auto` disimpan per akun/sesi/pelanggan, default FALSE. Full auto mengaktifkan kembali AI dan mencegah balasan manual menjeda percakapan. Pesan manual tetap masuk memory dan membatalkan jawaban yang sedang dibuat agar tidak mengirim jawaban berdasarkan riwayat lama; pesan pelanggan berikutnya kembali dilayani AI. Jeda AI mematikan full auto. Lanjutkan AI dari dashboard memakai mode biasa; Nonaktifkan full auto tetap membiarkan AI aktif. Hapus konteks mempertahankan mode yang dipilih. Mode ini tidak melewati pengaturan asisten nonaktif, saldo, atau pembatasan akun.

Context Agent membaca pesan pelanggan dan jawaban final, lalu menghasilkan satu baris tiga kata `subjek-predikat-objek` (maksimal 200 karakter). Konteks disimpan di `ai_conversations.router_context` hanya setelah pengiriman berhasil dan revision masih sama, terpisah dari riwayat chat. Router menggunakan konteks ini untuk pesan seperti “ya”, “yang itu”, atau “cukup”, dan mengikuti intent baru bila topik berubah. Jika pembaruan konteks gagal/invalid, jawaban tetap dikirim dan konteks lama dikosongkan agar tidak menyesatkan. Takeover manual mengosongkan konteks router; Hapus konteks menghapus kedua memori. Dashboard menampilkan S-P-O terakhir. Migrasi `migrateAI` menambahkan kolom nullable secara idempoten; percakapan lama dimulai tanpa S-P-O.

## Tiga tingkat model (khusus pemilik)

Pengaturan `/dashboard/admin/ai` menyediakan model murah, sedang, dan cerdas dengan endpoint/API key bersama. Router, Context Agent, Pembuka, dan Penutup memakai murah; Informasi, Konsultasi, Transaksi, Dukungan, dan Keluhan memakai sedang; Lainnya memakai cerdas. Pembagian ini tetap berdasarkan peran, tanpa eskalasi atau fallback otomatis saat provider gagal. Tombol tes per tingkat menguji konfigurasi yang sudah disimpan.

Migrasi menambahkan `model_cheap`, `model_medium`, `model_smart` nullable. Nilai yang belum diatur memakai model lama agar migrasi tidak mengganti provider/model aktif. Nama model di prototype tidak otomatis diaktifkan. Pemilik memilih nama model yang tersedia pada providernya. Konfigurasi diambil sekali per turn agar perubahan setting tidak mengganti model di tengah turn.

`ai_usage.model_calls` mencatat peran, model aktual, dan status transport (`responded`/`failed`) setiap panggilan, termasuk pengulangan specialist untuk tools. Status responded bukan jaminan output valid; status permintaan menunjukkan hasil akhir. Kolom model lama menyimpan model specialist saat generasi berhasil. Riwayat ini tersedia hanya di `/api/admin/ai/usage` dan halaman pemilik. API penggunaan client tidak mengirim model atau trace. Tarif kredit client tetap sama; proses routing dan Context Agent tidak ditagihkan tambahan.

## Tabel bawaan dan UI

### AI Studio (pemilik)

`/dashboard/admin/ai-studio` menyediakan kanvas node tetap, zoom, inspector, chat uji, dan trace langsung. Menu tersedia pada navigasi pemilik. Router, delapan specialist, dan Context Agent dapat diubah prompt, tingkat model, model khusus opsional, dan subset tools yang diizinkan. Model khusus memakai endpoint/API key global yang sama. Node memory, tools, input, dan output hanya untuk inspeksi; topology dan batas izin tools tetap dikendalikan server.

`ai_workflow` menyimpan draft, konfigurasi aktif, revision draft, dan versi aktivasi. Simpan draft tidak mengubah pelayanan. Aktivasi menyalin draft tersimpan secara atomik; engine mengambil snapshot konfigurasi aktif saat memulai setiap turn. Revision wajib cocok untuk save/publish agar tab atau pemilik lain tidak menimpa perubahan. Aktivitas save/publish masuk audit. Migrasi menambahkan tabel, sementara instalasi tanpa versi aktif tetap menggunakan prompt/pembagian model bawaan.

Playground menjalankan `runAgents`, validasi/repair, dan Context Agent yang sama dengan engine layanan. Trace NDJSON menampilkan input/output model, routing, model terpilih, durasi, retry, tools simulasi, dan konteks sebelum/sesudah. Panggilan provider nyata dapat menimbulkan biaya provider, tetapi tidak memotong kredit client, mengirim WhatsApp, memanggil endpoint bisnis, ataupun menulis produk/order produksi. Data Knowledge, Perilaku AI, dan katalog sandbox diisi terpisah. `create_order` hanya menghasilkan order SIM dalam sesi; `check_order` hanya membaca order SIM sesi itu. Kegagalan uji terlihat di trace, tanpa pesan bantuan WhatsApp.

Sesi sandbox hanya di memori proses: maksimal 5 per pemilik, 100 total, kedaluwarsa setelah 30 menit tidak digunakan, dan maksimal 50 pesanan per sesi. Satu pengujian aktif per pemilik. Restart server mengakhiri sesi uji; pada deployment multi-process diperlukan sticky routing untuk meneruskan sesi. Perubahan revision/data uji/model memerlukan percakapan uji baru. Stop/putus koneksi membatalkan request model aktif dan mencegah tool/panggilan berikutnya. Riwayat trace ditampilkan per pengujian di browser, bukan disimpan sebagai log percakapan client.

API Studio berada di `/api/admin/ai/studio`: GET membaca draft/aktif, PUT menyimpan, POST `/publish` mengaktifkan, dan POST `/run` mengalirkan trace. Semua membutuhkan cookie pemilik; write wajib origin aplikasi. Kredensial provider tidak masuk respons/trace. Payload dibatasi 128 KB dan pengujian dibatasi 10 permintaan/menit. Uji: `test/ai-studio.test.ts` dan `npx tsx --env-file=.env scripts/browser-ai-studio-check.ts` memakai provider tiruan; tangkapan desktop/mobile tersedia di `data/browser-check/studio-*.png`.

Di halaman Asisten AI, client dapat:

- Mengisi Knowledge dan Perilaku AI.
- Memilih Tabel NC-WA atau Custom endpoint untuk Produk dan Order masing-masing.
- Menambah/mengubah produk atau layanan: kode, nama, jenis, deskripsi, harga rupiah, stok/kapasitas, dan status aktif. Menonaktifkan produk mengeluarkannya dari katalog agent.
- Membuat pesanan manual dan melihat pesanan dari agent; memperbarui status (`pesanan_masuk`, `dibayar`, `diproses`, `selesai`, `dibatalkan`) dan catatan.
- Melihat agent pada riwayat AI serta menjeda/menghapus konteks pelanggan.

Katalog tool menampilkan maksimal 20 hasil dan mendukung pencarian nama/kode. UI menampilkan maksimal 200 produk dan 200 pesanan terbaru. Form manual membuat satu jenis item per pesanan; API/agent mendukung 1–20 jenis item. Harga/nama item disalin dari sumber Produk yang dipilih, bukan dari input harga model/browser. Snapshot tidak berubah ketika produk diedit atau dinonaktifkan.

Order bawaan berstatus awal `pesanan_masuk`: pencatatan permintaan, bukan bukti pembayaran atau komitmen stok. Stok/kapasitas diperiksa saat pencatatan tetapi tidak dikurangi atau direservasi otomatis. Pemilik bisnis meninjau dan memproses pesanan. Produk diarsipkan dengan nonaktif; order dibatalkan melalui status sehingga riwayat dan idempotensi tetap ada.

Saat sumber custom dipilih, agent menggunakan endpoint; tabel NC-WA sebelumnya tetap tersimpan dan tetap dapat dikelola. Pengelolaan data **remote** dilakukan di sistem client. Tombol tambah/edit pada tabel NC-WA selalu mengelola data lokal. Pergantian sumber tidak menyalin atau menyinkronkan data otomatis.

## Isolasi dan idempotensi

Semua konfigurasi, produk, dan order mempunyai scope `(account_id, session_id)`. Memory memakai `(account_id, session_id, customer)`. Gateway memperoleh identitas akun dari autentikasi lalu memeriksa kepemilikan session. Agent hanya dapat membaca order milik pelanggan WhatsApp yang sedang dilayani. UI tenant dapat mengelola seluruh order dalam session miliknya.

Memory bertahan setelah restart. Default instalasi baru 60 pesan (sekitar 30 interaksi); setting lama tetap dipertahankan. Batas global 1–100 pesan dikelola pemilik SaaS. Isi memory hanya pesan pengguna/balasan, termasuk takeover manual; output routing/tool tidak disimpan ke memory.

Pembuatan order bawaan memakai unique request ID per tenant/session, hash payload, transaksi MySQL dan lock akun. Retry input sama mengembalikan order yang sama, termasuk setelah restart/perubahan harga. Payload berbeda dengan key sama ditolak. Order yang telah tersimpan **tidak dibatalkan** jika tahap AI berikutnya atau pengiriman WhatsApp gagal; client dapat meninjau order tersebut di tabel.

Custom endpoint wajib menerapkan idempotensi persisten berdasarkan header `Idempotency-Key`. Key dibuat server, dibatasi tenant/session/customer/request/action; produk read dan order create tetap berbeda meskipun menggunakan URL sama. Tool baca boleh retry sekali pada kegagalan sementara; `create_order` yang gagal/ambigu tidak diulang otomatis. Client endpoint bertanggung jawab memfilter data sesuai tenant/session/customer dan menerapkan aturan bisnisnya sendiri; NC-WA memeriksa nomor pelanggan dan ID pada hasil baca order.

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
    "total":250000, "status":"pesanan_masuk", "notes":"Tolong siapkan"
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

Router memakai JSON Schema tetap dengan enum `pembuka`, `informasi`, `konsultasi`, `transaksi`, `dukungan`, `keluhan`, `penutup`, `lainnya`. Schema selalu disisipkan meskipun prompt router dikustomisasi. Instruksi router tetap mengarahkan konteks S-P-O tiga kata, tetapi validator hanya mensyaratkan ringkasan non-kosong maksimal 200 karakter. Validator tetap memeriksa enum, field wajib tanpa tambahan, dan kesamaan pesan asli; hasil tidak valid mendapat satu percobaan koreksi sebelum gagal.

## Fallback tim

Pada setiap pesan, aplikasi membaca maksimal lima tiket `waiting` terbaru dengan filter account, session, dan pelanggan. Ringkasan ID dan pertanyaan diberikan kepada Router bersama konteks S-P-O. Output Router menyertakan `fallback_terkait` berupa array ID tiket relevan; `[]` berarti tidak terkait. Validator menolak ID di luar daftar dan ID duplikat. Hanya tiket terpilih ditambahkan ke prompt specialist; daftar lengkap tidak dimasukkan ke shared memory. Jejak `router/routed` di AI Studio menampilkan properti tersebut. Status tiket tetap bersumber dari database pada setiap pesan, bukan disalin ke konteks S-P-O permanen.

Prompt lama yang menghilangkan `fallback_terkait` masih diterima sebagai `[]` hanya ketika tidak ada tiket menunggu. Jika ada kandidat tiket, properti ini wajib dan output tidak valid mendapat koreksi terbatas. Pemilihan relevansi dan pencegahan duplikat semantik tetap bergantung pada model; perubahan ini tidak menjamin penghematan total token karena ringkasan tiket kini dibaca Router.

Setiap sesi dapat menyimpan nomor WhatsApp fallback di halaman Asisten AI. Saat specialist mengeluarkan fallback karena data tidak tersedia atau perlu keputusan manusia, sistem membuat tiket `ai_fallbacks` yang terikat pada account, session, pelanggan, pesan sumber, konteks, dan snapshot riwayat. Pelanggan menerima konfirmasi singkat, sedangkan tim menerima pertanyaan dengan ID tiket. AI tetap aktif untuk pertanyaan pelanggan lain.

Tim membalas notifikasi WhatsApp menggunakan Reply, atau menulis ID tiket pada balasan. Sistem mencari tiket hanya dalam account dan session yang menerima balasan, lalu meneruskan jawaban tim kepada pelanggan dan menutup tiket. Endpoint `GET /sessions/:id/ai/fallbacks` menampilkan tiket untuk sesi tersebut saja.

Di AI Studio, pilih Router untuk melihat schema dan opsi **Gunakan Structured Outputs provider**. Opsi ini default nonaktif, termasuk pada draft lama. Aktifkan hanya setelah memastikan provider/model mendukung `response_format` JSON Schema strict; simpan untuk menguji draft, lalu terbitkan untuk produksi. Hanya panggilan router yang mengirim schema ke provider. Specialist dan Context Agent tetap memakai protokol masing-masing. Format mengikuti [dokumentasi Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Dukungan provider nyata perlu diuji menggunakan kredensial yang valid.

`npm run migrate` menambah `ai_data_sources`, `ai_products`, `ai_orders`, serta metadata agent pada usage. Migrasi additive, aman diulang, dan tidak menghapus data lama. Kolom `demo_tools` dari versi prototype, bila sudah ada, tidak lagi dibaca. Jalankan migrasi sebelum runtime baru; `npm run build` menghasilkan `dist`.

Tarif/reservasi lama dipertahankan: input yang ditagihkan adalah instruksi service/perilaku dan memory; output adalah jawaban final. Knowledge/produk/order yang diambil lewat tools, router, Context Agent, dan prompt tambahan merupakan proses internal tanpa potongan tambahan. Jawaban valid yang gagal dikirim tetap mengikuti aturan tagihan AI lama.

Tes: `test/ai-agents.test.ts`, `test/ai-data.test.ts`, `test/ai.test.ts`, suite `npm test`, serta `npm run test:browser` (CHROMIUM_PATH bila perlu). Pengujian mencakup data persisten, kombinasi sumber, tenant/session/customer, endpoint invalid, harga snapshot, idempotensi, takeover, routing/shared memory, dan UI desktop/mobile.

`npx tsx --env-file=.env scripts/test-ai-live.ts` adalah smoke test penyedia berbayar opsional dengan data sintetis dan adapter in-memory, tanpa pengiriman WhatsApp atau order nyata. Uji provider terakhir pada 17 September 2026 tertahan HTTP 401; key perlu diperbarui. Endpoint client nyata dan HP WhatsApp belum diuji; pengujian adapter/WhatsApp memakai transport tiruan.
