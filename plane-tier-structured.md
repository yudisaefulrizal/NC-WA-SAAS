# Rencana Tier Model Structured

Tanggal: 24 September 2026.

Status: belum dikerjakan. Dokumen ini mencatat kapan tier khusus structured output layak dibuat dan apa saja yang harus diubah. Keputusan saat ini adalah **tidak** membuat tier baru.

## 1. Kondisi sekarang

Agent Layanan menulis pesanan sebagai satu baris `2 x Produk; catatan: ...`. Parser kode di `src/ai-order-schema.ts` mengubahnya menjadi JSON tanpa memanggil AI. Node `pesanan` hanya dipanggil bila parser tidak dapat memastikan isinya.

- Tier default node `pesanan` adalah **Murah** (`roleTier` di `src/ai-models.ts`). Nama model dapat diganti per node di AI Studio.
- Mode default node `pesanan` adalah prompt: schema ditulis di instruksi, jadi model tanpa dukungan JSON Schema tetap bisa dipakai. `structured_output` dapat dicentang untuk mengirim `response_format`; bila provider menolak (HTTP 400), node otomatis mencoba ulang dalam mode prompt.
- Router juga dapat memakai structured output secara opsional dan tetap berada di tier-nya sendiri.
- Jawaban model selalu diperbaiki secara deterministik lalu divalidasi terhadap katalog (`validateOrderOutput`). Output yang tidak valid dikembalikan ke Agent Layanan sebagai `order_invalid`, jadi pesanan tidak pernah dibuat dari data yang salah.

Karena dukungan provider tidak lagi wajib, kebutuhan tier khusus structured makin kecil. Tier ini baru relevan bila akurasi mode prompt pada model murah ternyata kurang dan model structured yang andal hanya ada di provider lain.

## 2. Batasan yang memicu tier baru

Override model per node hanya mengganti **nama model**. Provider, endpoint, dan API key tetap mengikuti profil yang dirutekan ke tier node tersebut (`tierConfig` lalu `roleConfig`).

Tier khusus layak dibuat bila salah satu kondisi ini terjadi:

1. Model yang mendukung structured output hanya tersedia di provider lain. Contohnya, tier Murah memakai Sumopod tetapi model structured yang andal hanya ada di OpenRouter.
2. Makin banyak node yang wajib structured, misalnya Router selalu strict atau ada node ekstraksi baru. Mengatur model per node satu per satu menjadi rawan lupa.
3. Admin perlu satu tempat untuk mengganti "model structured" tanpa membuka AI Studio.

Kalau yang dibutuhkan hanya poin 1, pertimbangkan dulu opsi B di bagian 4 karena perubahannya lebih kecil.

## 3. Opsi A: tier keempat `structured`

Tier baru `structured` (label: **Terstruktur**) sejajar dengan `cheap`, `medium`, dan `smart`.

### Perubahan yang dibutuhkan

| Area | File | Perubahan |
|---|---|---|
| Definisi tier | `src/ai-models.ts` | Tambah `'structured'` ke `modelTiers`. Ubah `roleTier.pesanan` menjadi `'structured'`. |
| Skema DB | `src/ai-schema.ts` | Kolom `model_structured` di `ai_settings` dan `ai_provider_profiles`. Isi awal disalin dari `model_cheap` agar perilaku tidak berubah. Rute `structured` di `ai_provider_routes` disalin dari rute `cheap`. |
| Konfigurasi | `src/ai.ts` | `configure()`, `saveProviderProfile()`, dan `setProviderRoutes()` menerima tier baru. `AIConfig` mendapat `model_structured`. |
| Validasi workflow | `src/ai-workflow.ts` | Otomatis mengikuti `modelTiers`. Workflow lama yang menyimpan `tier: 'cheap'` untuk `pesanan` tetap valid; putuskan apakah dimigrasikan ke `structured`. |
| Admin AI | `public/app.js`, `public/index.html` | Baris ke-4 di "Model per tingkat" (tab Model) dan field model ke-4 di dialog profil provider. |
| AI Studio | `public/ai-studio.js` | Opsi tier di pemilih node dan teks di node `models`. |
| Auto Share | `src/auto-share-tidy.ts` | Periksa pemakaian tier di sini; perapihan saat ini memakai tier Murah. |
| Tes | `test/ai-agents.test.ts`, `test/ai-router-schema.test.ts`, `test/ai-studio.test.ts`, `test/ai.test.ts`, `test/auto-share.test.ts`, `scripts/browser-ai-studio-check.ts` | Tes pemilihan tier ("Three model tiers select by role"), migrasi rute, dan tampilan pilihan tier. |

### Aturan yang perlu diputuskan saat implementasi

- **Kompatibilitas:** tier `structured` wajib punya rute. Migrasi harus mengisinya dari rute `cheap` sebelum kode baru membaca tier tersebut. Kalau tidak, `tierConfig` jatuh ke konfigurasi lama tanpa profil.
- **Router:** saat `structured_output` aktif, apakah Router otomatis pindah ke tier `structured`? Usulan: tidak. Tier tetap dipilih eksplisit di AI Studio, supaya satu centang tidak diam-diam mengganti provider.
- **Tes koneksi:** tombol "Uji" profil provider sebaiknya mengirim contoh `response_format` untuk tier `structured`, supaya ketidakcocokan model ketahuan sebelum dipakai pelanggan.
- **Biaya:** tarif kredit berlaku per kata, bukan per tier, jadi tidak ada perubahan billing.

## 4. Opsi B: profil provider per node (lebih ringan)

Node di workflow mendapat field opsional `profile_id`. Kalau diisi, `roleConfig` memakai provider, endpoint, dan secret dari profil itu, lalu model dari field `model` node.

- Menyelesaikan poin 1 di bagian 2 tanpa kolom DB baru di `ai_settings` maupun rute baru.
- Perubahan: `AgentWorkflow` (field baru), `workflowInput` (validasi profil aktif), `roleConfig` (memuat profil dari `tier_profiles` atau query terpisah), dan pemilih profil di inspector AI Studio.
- Kekurangan: pengaturan tersebar per node, dan menghapus profil harus memeriksa workflow aktif maupun draft.

## 5. Rekomendasi

1. Tetap di kondisi sekarang selama model structured tersedia di provider yang sama dengan tier Murah.
2. Kalau muncul kebutuhan provider berbeda untuk satu atau dua node, ambil opsi B.
3. Ambil opsi A hanya kalau structured output menjadi kebutuhan banyak node dan admin ingin mengaturnya dari satu tempat.

## 6. Cara cek dukungan model

- OpenRouter: daftar model menampilkan `supported_parameters`. Cari `structured_outputs` atau `response_format`.
- Provider lain yang kompatibel OpenAI: kirim permintaan uji dengan `response_format` dari `orderResponseFormat(['Produk uji'])`, lalu pastikan jawabannya JSON yang lolos `validateOrderOutput`.
