# Rencana Multi-Profil AI

Tanggal: 24–25 September 2026.

Status: fondasi sudah diimplementasikan dengan CS Usaha sebagai profil pertama. Desain disetujui di kanvas Claude Design "Desain Multi-Profil NC-WA". Bukti pengujian dicatat di AGENT.MD.

## 1. Pengertian

- **Profil** adalah modul aplikasi AI yang disediakan sistem. Isinya: node dan alurnya, tool, bentuk data yang dibutuhkan, jenis hasil kerja, dan tab menu sesi. Profil bisa sangat berbeda satu sama lain. Contoh yang direncanakan:

  | Profil | Contoh data profil | Contoh hasil kerja |
  | --- | --- | --- |
  | CS usaha (tersedia) | Knowledge, produk | Balasan chat, pesanan |
  | Asisten pribadi | Catatan, jadwal | Pengingat, ringkasan |
  | Pembuat artikel | Topik, gaya tulisan | Artikel |
  | Generate carousel | Brand, warna, template | Gambar slide |
  | Tester profil | Skenario uji, persona pelanggan palsu | Laporan lulus/gagal |

  Profil didaftarkan di `src/ai-profiles.ts`. Admin menyetel prompt, model, dan tool setiap node di AI Studio, serta menyalakan atau mematikan profil untuk semua klien sekaligus.
- **Data profil** adalah isi milik klien untuk satu profil. Data profil bisa dipasang ke beberapa sesi, dicabut, dan dipakai lagi.
- **Sesi** menjalankan satu profil dengan satu data profil. Keadaan percakapan (memori AI, konteks S-P-O, riwayat chat, jeda, tiket fallback) tetap milik sesi.

```
Sesi = Profil (mesin, dari sistem) + Data profil (isi, dari klien) + keadaan percakapan (otomatis)
```

Kerangka umum hanya menyediakan hal yang dipakai semua profil:
- sesi WhatsApp;
- kredit AI;
- model dan provider;
- penyimpanan alur per profil untuk AI Studio;
- log dan trace;
- tab Percakapan, Uji Pesan, dan Integrasi.

Hal yang khas satu profil, seperti produk dan pesanan, tetap milik profil tersebut.

## 2. Keputusan

| Pertanyaan | Keputusan |
| --- | --- |
| Tahap ini | Fondasi multi-profil; CS Usaha satu-satunya profil |
| Ketersediaan profil | Admin menyalakan/mematikan secara global. Profil baru muncul dalam keadaan nonaktif |
| Data profil | Milik akun, bernama unik per akun, bisa dipasang ke banyak sesi sekaligus |
| Pesanan | Milik data profil, dengan catatan sesi asal (kosong bila dibuat dari halaman Data Profil) |
| Nomor fallback tim | Milik data profil. Tiket fallback tetap per sesi |
| Mengganti atau mencabut data profil | Mengosongkan memori AI dan konteks S-P-O sesi itu, lalu mencatat catatan di riwayat chat |
| Uji Coba | Di tab Sesi menguji data profil yang terpasang; dari Data Profil bisa menguji yang belum dipasang |
| Letak Data Profil | Pengalih **Sesi \| Data Profil** di halaman Asisten AI, bukan menu atas baru |
| Memasang profil | Status AI sesi tidak diubah. Setelah pemasangan pertama AI masih nonaktif sampai klien menyalakannya |
| Profil dimatikan admin | AI berhenti di semua sesi pemakainya. Data profil tidak dihapus. Klien tetap melihat profil yang sudah dipakainya dengan label nonaktif, tetapi tidak bisa memilihnya |

## 3. Data

| Tabel | Isi |
| --- | --- |
| `ai_profile_types` | Saklar global per profil |
| `ai_workflow` | Satu baris per profil (`profile_type`), draft dan publish masing-masing |
| `ai_data_profiles` | Nama, profil, perilaku, bidang knowledge, nomor fallback |
| `ai_assistants` | Per sesi: saklar AI dan `data_profile_id` |
| `ai_products`, `ai_data_sources`, `ai_product_images` | Kunci `data_profile_id` |
| `ai_orders` | Kunci `data_profile_id` ditambah `session_id` asal |
| `ai_usage`, `ai_trace_log` | Ditambah `profile_type` (usage juga `data_profile_id`) |

**Migrasi data lama.** Setiap sesi yang punya pengaturan atau data dibuatkan data profil `CS – <sesi>`, yang langsung dipasang dengan status AI tetap. Knowledge, produk, foto, sumber data, dan pesanan ikut dipindah, dan alur global menjadi alur profil CS. Migrasi aman dijalankan ulang.

## 4. API

- `GET /ai/profile-types` mengembalikan profil yang aktif ditambah profil yang sudah dipakai akun, lengkap dengan status `enabled`.
- **Data profil:**
  - `GET` dan `POST /ai/data-profiles`. `copy_from` dipakai untuk menduplikat, dan setiap foto ikut disalin sebagai file tersendiri.
  - `GET`, `PATCH`, dan `DELETE /ai/data-profiles/:id`. Hapus hanya bisa bila data profil tidak terpasang di sesi mana pun.
  - `PATCH /ai/data-profiles/:id/field`.
  - `/ai/data-profiles/:id/products`, `/products-image`, dan `/orders`.
- **Pasang ke sesi:** `PUT /sessions/:id/ai/profile` dengan body `{"data_profile_id":ID|null,"enabled"?:bool}`.
- **Admin:**
  - `GET /api/admin/ai/profiles` dan `PUT /api/admin/ai/profiles/:profile`.
  - AI Studio memakai `?profile=` di setiap endpoint studio.
- **Kompatibilitas endpoint lama.** Endpoint `/sessions/:id/ai/...` tetap bekerja pada data profil yang terpasang. Bila sesi belum berprofil, penulisan pertama membuat dan memasang `CS – <sesi>`.

## 5. Langkah berikutnya

1. Menambah profil kedua. Setiap profil baru butuh:
   - definisi di `src/ai-profiles.ts`;
   - bentuk data profilnya;
   - runtime pipeline, karena saat ini `process()` di `ai.ts` adalah runtime CS;
   - simulasi AI Studio;
   - tab menu sesi.
2. Profil yang bekerja terhadap profil lain (tester) membutuhkan target profil dan tempat menyimpan hasil kerja non-chat, seperti laporan, artikel, atau gambar.
