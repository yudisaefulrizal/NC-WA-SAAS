# Rencana: Template Auto Share dengan Sumber Data Endpoint

Template auto-share dapat menarik data hidup dari endpoint HTTPS milik pengguna,
lalu menyisipkannya ke teks/caption lewat placeholder `{{nama_variabel}}`, dan
opsional mengambil media dari URL yang dikembalikan endpoint tersebut.

Data diambil saat pengiriman dibuat — manual maupun terjadwal — lalu dibekukan
ke snapshot run. Template tanpa sumber data berperilaku persis seperti sekarang.

---

## 1. Kontrak endpoint

nc-wa-saas yang memegang kontrak. Penyedia data menyesuaikan.

### Request

```
GET https://ppdb.pesantren.id/api/ncwa/statistik
Authorization: Bearer <token>        ← hanya bila token diisi
User-Agent: NC-WA/0.1
Accept: application/json
```

### Respons wajib HTTP 200

```json
{
  "data": { "jumlah": 247, "sisa_kuota": 53, "gelombang": "Gelombang 2" },
  "media": {
    "url": "https://ppdb.pesantren.id/poster/gelombang-2.jpg",
    "filename": "poster-ppdb.jpg"
  }
}
```

Blok `media` opsional; hanya dibaca bila template memakai sumber media endpoint.

### Aturan yang ditegakkan

| Aturan | Nilai |
|---|---|
| Metode | `GET` |
| Protokol | HTTPS publik, tanpa redirect, tanpa kredensial di URL |
| Bentuk `data` | objek datar — array & nesting ditolak |
| Key | `[a-z0-9_]{1,40}` |
| Nilai | string / number / boolean. `null`, objek, array ditolak |
| Panjang nilai | ≤200 karakter setelah konversi |
| Jumlah key | ≤50 |
| Respons JSON | ≤32 KB |
| Timeout | 10 detik |
| Media | ≤8 MB, tipe disahkan lewat `sniffMediaType` |

### Konversi nilai ke teks

- **number** → format Indonesia: `1247` → `1.247`
- **boolean** → `true` → `Ya`, `false` → `Tidak`
- **string** → apa adanya

### Aturan perilaku

- **Data hilang → batal.** Placeholder tanpa nilai membatalkan seluruh run,
  dicatat gagal dengan alasan spesifik. Tidak ada pesan setengah jadi terkirim.
- **Escape:** `{{{{` menghasilkan `{{` literal.
- **Snapshot:** semua kontak dalam satu run menerima teks dan media yang sama.

---

## 2. Skema database

Di `migrateAutoShare` (`src/auto-share-schema.ts`), memakai helper `column()`/`index()`
yang sudah ada.

```ts
// Sumber data pada template
await column('auto_share_templates','source_mode',"VARCHAR(16) NOT NULL DEFAULT 'none'");
await column('auto_share_templates','source_endpoint',"VARCHAR(512) NOT NULL DEFAULT ''");
await column('auto_share_templates','source_secret','TEXT NULL');
await column('auto_share_templates','media_source',"VARCHAR(16) NOT NULL DEFAULT 'asset'");

// Audit: data mentah yang dipakai run
await column('auto_share_runs','source_data','JSON NULL');

// Penanda asset sementara — TIDAK dihitung kuota
await column('share_assets','run_id','CHAR(36) NULL');
await index('share_assets','asset_run','INDEX asset_run(run_id)');
```

Default `'none'` dan `'asset'` membuat seluruh template lama otomatis benar
tanpa migrasi data.

`share_assets.run_id`:
- `NULL` → galeri permanen milik pengguna, dihitung kuota
- terisi → sementara, milik satu run, **tidak dihitung kuota**, dihapus setelah selesai

> Sengaja TIDAK memakai foreign key ke `auto_share_runs`, agar penghapusan run
> tidak menghapus baris asset sebelum filenya dibersihkan dari disk.

---

## 3. Modul baru: `src/auto-share-source.ts`

File terpisah agar `auto-share.ts` tidak membengkak dan logika ini dapat diuji
berdiri sendiri tanpa DB maupun jaringan.

### Fungsi murni (tanpa I/O)

| Fungsi | Tugas |
|---|---|
| `parsePlaceholders(text): string[]` | Ekstrak nama variabel unik, hormati escape `{{{{` |
| `renderTemplate(text, data): string` | Substitusi + konversi nilai; lempar `ApiError` bila ada yang hilang |
| `validateSourceData(raw): Record<string,string>` | Tegakkan seluruh aturan kontrak `data` |
| `validateSourceMedia(raw): {url,filename?}` | Validasi blok `media`, URL lewat `validatePublicUrl` |
| `sourceInput(body)` | Validasi input form template |

Pesan error wajib spesifik dan berbahasa Indonesia, mis.
`Data "sisa_kuota" tidak tersedia dari sumber`.

### Transport (injectable)

```ts
export type SourceTransport = (endpoint: string, secret: string) => Promise<Record<string, unknown>>;
```

Implementasi `fetchSource` menyalin pola `callEndpoint` di `src/ai-data.ts:39-49`:
`validatePublicUrl` untuk DNS pinning, `agent:false`, batas 32 KB, tanpa redirect.
Beda: method `GET`, timeout 10 detik.

> **WAJIB:** semua kegagalan (timeout, DNS, TLS, JSON invalid, status ≠ 200)
> harus terbungkus `ApiError`. Error non-`ApiError` akan di-`throw` dari
> `schedule()` dan menghentikan tick untuk **semua akun**.

---

## 4. Perubahan `src/auto-share.ts`

### 4a. `templateInput` — validasi tambahan

Menerima `source_mode`, `source_endpoint`, `source_token`, `source_clear_token`,
`media_source`.

Aturan tambahan:
- Tipe `audio` **tidak boleh** punya sumber data — audio tak punya caption
- `source_mode='none'` tapi teks mengandung `{{...}}` → **tolak**, cegah pengguna
  mengira substitusi jalan padahal belum dinyalakan
- `media_source='endpoint'` hanya sah bila `source_mode='endpoint'` dan tipe ≠ `text`
- `media_source='endpoint'` → `asset_id` tidak wajib

### 4b. `saveTemplate` — penyimpanan token

Mengikuti pola `saveSource` (`src/ai-data.ts:35`):

| Kondisi | Aksi |
|---|---|
| Token baru diisi | `encrypt()` |
| Kosong + endpoint sama | pertahankan token lama |
| Kosong + endpoint berubah | **hapus token** (cegah bocor ke host lain) |
| `clear_token` | hapus |

Token tidak pernah dikembalikan ke browser. API hanya mengirim `has_token: boolean`.

### 4c. `AssetStore` — mode sementara

`save()` saat ini selalu mengecek kuota (`src/engine/assets.ts:53-57`) dan
menghitung `COUNT(*)` tanpa filter. Dua perubahan:

1. Tambah metode `saveTemporary(accountId, runId, filename, body, maxBytes)` —
   melewati pengecekan kuota, mengisi `run_id`, memakai batas 8 MB.
   Tetap memakai `sniffMediaType` untuk mengesahkan tipe dari byte asli.
2. Query kuota di `save()` ditambah `AND run_id IS NULL`.

### 4d. Query galeri — kecualikan asset sementara

Tambah `AND run_id IS NULL` pada tiga tempat di `src/auto-share.ts:105-110`:
- `GET /assets` (daftar)
- perhitungan `used_count` / `used_bytes`
- (pengecekan asset dipakai template sudah aman karena asset sementara tak pernah dirujuk template)

**Inilah yang membuat media dari URL tidak memotong kuota** — bukan dikecualikan
secara khusus, tapi memang tidak pernah ikut dihitung.

### 4e. Prefetch sebelum transaksi — BAGIAN PALING SENSITIF

**Masalah:** `enqueue()` berjalan di dalam transaksi dengan `accountLock` +
`lockJob FOR UPDATE` aktif (`src/auto-share.ts:177` dan `:186`). HTTP call di sana
menahan lock akun dan memblokir tick untuk akun lain.

**Solusi:** fungsi baru `prefetchSource(account, job, templateId)` dipanggil
**sebelum** `beginTransaction`:

1. Tentukan template yang akan dipakai:
   - `manual` → template yang dipilih pengguna
   - `schedule` → `template_ids[rotation_index % length]`
2. Bila `source_mode='none'` → kembalikan `null`, tidak ada HTTP
3. Panggil endpoint, validasi `data`
4. Bila `media_source='endpoint'` → unduh media **sekali**, simpan via
   `saveTemporary()`, dapatkan `asset_id`
5. Kembalikan `{ data, assetId?, filename? }`

> Normalnya **satu panggilan HTTP per pengiriman**, bukan sebanyak jumlah template.

Lalu `enqueue` menerima hasilnya sebagai parameter:

```ts
async function enqueue(c, t, source, selected?, resolved?)
```

Di dalamnya, setelah template dibaca (`src/auto-share.ts:73-75`):

```ts
const v = content[0];
const message = v.source_mode === 'endpoint'
  ? renderTemplate(v.message, resolved!.data)
  : v.message;
const assetId = v.media_source === 'endpoint' ? resolved!.assetId : v.asset_id;
```

`message`, `assetId`, dan `source_data` disimpan ke run. Sisa fungsi tidak berubah.

**Race pada rotasi:** rotation_index dibaca di luar transaksi lalu dipakai di dalam.
Karena `schedule()` sudah memegang `accountLock` per akun dan satu job hanya
diproses satu kali (`already_running` di `:62-63`), risiko ini tidak terwujud.
Namun `enqueue` tetap harus memverifikasi bahwa template yang di-prefetch sama
dengan yang akhirnya terpilih; bila berbeda → batalkan run dengan `invalid_request`.

### 4f. `deliver()` — TIDAK BERUBAH

Karena media endpoint sudah tersimpan sebagai asset lokal saat enqueue,
`readAsset` di `src/auto-share.ts:214` tetap dipakai apa adanya.
Ini keuntungan utama pendekatan unduh-saat-enqueue.

### 4g. Pembersihan asset sementara — DUA LAPIS

**Lapis 1 — akhir `deliver()`** (`src/auto-share.ts:222-225`):
setelah status run jadi final (`completed`, `completed_with_errors`), hapus
asset sementara milik run tersebut. Termasuk saat run gagal.

```ts
async function cleanupRunAssets(accountId: string, runId: string) {
  const [rows] = await db.execute('SELECT id FROM share_assets WHERE account_id=? AND run_id=?', [accountId, runId]);
  for (const row of rows) await assets.remove(accountId, row.id).catch(() => {});
  await db.execute('DELETE FROM share_assets WHERE account_id=? AND run_id=?', [accountId, runId]);
}
```

**Lapis 2 — penyapu di `recover()`** (`src/auto-share.ts:225-228`):
hapus semua asset sementara yang run-nya sudah tidak aktif, atau yang run-nya
sudah tidak ada. Ini jaring pengaman untuk crash.

```sql
SELECT a.id, a.account_id FROM share_assets a
LEFT JOIN auto_share_runs r ON r.id = a.run_id
WHERE a.run_id IS NOT NULL
  AND (r.id IS NULL OR r.status NOT IN ('queued','running'))
```

`recover()` sudah dipanggil saat startup dan saat tick error, jadi tidak perlu
mekanisme penjadwalan baru.

> Tanpa lapis 2, satu crash meninggalkan file yang tak akan pernah terhapus.

### 4h. Penanganan kegagalan

Semua kegagalan dilempar sebagai `ApiError(400,'invalid_request', <alasan>)`.

- **Manual** → error naik ke response HTTP, pengguna langsung melihat alasannya
- **Schedule** → jatuh ke cabang `invalid_request` yang **sudah ada** di
  `src/auto-share.ts:202-209`: run dicatat gagal dengan alasan, `next_at` tetap
  bergeser. Tidak perlu kode baru.

Bila prefetch sudah menyimpan asset sementara lalu enqueue gagal, asset itu
wajib dihapus di blok `catch`.

---

## 5. Endpoint baru: uji koneksi

```
POST /auto-share/templates/test-source
body: { source_endpoint, source_token?, template_id? }
→ { ok: true, variables: { jumlah: "247", sisa_kuota: "53" },
    media: { url: "...", media_type: "image", size_bytes: 184320 } | null }
```

Memanggil endpoint, memvalidasi, mengembalikan daftar variabel beserta nilainya.
Bila `template_id` dikirim dan token dikosongkan, memakai token tersimpan.

Media hanya diperiksa (HEAD/unduh terbatas lalu dibuang), tidak disimpan.

> Tanpa endpoint ini pengguna harus menebak nama variabel. Ini bukan pemanis —
> ini yang membuat fitur bisa dipakai.

---

## 6. Dashboard

### `public/index.html` — dialog template (baris 73)

Setelah blok `share-media-fields`, sisipkan blok sumber data:
`select` mode, URL endpoint, token, checkbox hapus token, status token,
tombol **Tes koneksi**, area variabel, dan `<details>` panduan.

Pilihan **Sumber media** (hanya tampil bila tipe ≠ text):
| Pilihan | Perilaku |
|---|---|
| Galeri asset | seperti sekarang |
| Dari endpoint | pakai `media.url` dari respons |

Blok `<details>` panduan mengikuti gaya "Panduan custom endpoint produk"
yang sudah ada di `public/index.html:47`.

### `public/app.js`

- `shareSourceFields()` — tampil/sembunyi, mirip `shareMediaFields()` (`:573`).
  Sembunyikan seluruhnya saat tipe `audio`
- Tombol **Tes koneksi** → tampilkan variabel sebagai chip yang **bisa diklik
  untuk menyisipkan** `{{nama}}` ke posisi kursor di textarea
- `openShareTemplate()` (`:575`) — isi field baru, tampilkan status token
- `form('share-template-form')` (`:577`) — kirim field baru
- Tabel template (`:525`) — penanda kecil untuk template bersumber data

---

## 7. Dokumentasi

Blok `<details>` baru di tab **Dokumentasi**: kontrak lengkap, contoh JSON,
contoh implementasi PHP/Node singkat, dan daftar pesan error beserta artinya.
Ini yang dikirim ke pembuat data.

---

## 8. Pengujian

### Unit — `test/auto-share.test.ts`

Murni fungsi, tanpa jaringan:
- `parsePlaceholders`: ekstraksi, duplikat, escape `{{{{`
- `renderTemplate`: substitusi, format ribuan, boolean → Ya/Tidak, variabel hilang → error
- `validateSourceData`: tolak array, nesting, `null`, key >50, nilai >200 char, nama key ilegal
- `validateSourceMedia`: tolak http, tolak IP privat, tolak URL berkredensial
- `templateInput`: tolak `audio` + sumber data; tolak `{{...}}` saat mode `none`;
  tolak `media_source='endpoint'` saat `source_mode='none'`

### Integrasi — transport palsu

- Job terjadwal + template bersumber → run berisi pesan tersubstitusi
- Endpoint gagal → run `failed`, alasan tercatat, `next_at` **tetap bergeser**
- Variabel hilang → tidak ada `auto_share_deliveries` dibuat
- Media endpoint → asset sementara dibuat, `run_id` terisi
- Setelah run selesai → asset sementara terhapus, file hilang dari disk
- Asset sementara **tidak** muncul di `GET /assets` dan **tidak** menambah `used_bytes`
- Kuota penuh → media endpoint **tetap bisa** dipakai
- Crash simulasi → `recover()` menyapu asset yatim
- Template `source_mode='none'` → perilaku identik (regresi)
- Ganti endpoint tanpa token baru → token lama terhapus

### Regresi penuh

```
npx tsx scripts/test-auto-share.ts --all
```

Runner MySQL sementara yang sudah ada, plus `scripts/browser-auto-share-check.ts`.

---

## 9. Urutan pengerjaan

| # | Langkah | Catatan |
|---|---|---|
| 1 | Skema + kolom baru | Fondasi, tidak memecahkan apa pun |
| 2 | `auto-share-source.ts` + unit test | Murni, bisa dites tanpa DB |
| 3 | `AssetStore.saveTemporary` + filter kuota | Termasuk `AND run_id IS NULL` |
| 4 | `templateInput` + `saveTemplate` | CRUD dulu, sebelum runtime |
| 5 | Endpoint uji koneksi | Bisa dites manual via curl |
| 6 | **Prefetch + refactor `enqueue`** | **TITIK PALING BERISIKO** |
| 7 | Pembersihan dua lapis | `deliver()` + `recover()` |
| 8 | Dashboard | Setelah backend terbukti |
| 9 | Dokumentasi | |
| 10 | Regresi penuh | Wajib sebelum dianggap selesai |

Langkah 6 satu-satunya yang menyentuh jalur pengiriman yang sudah berjalan.
Jalankan regresi segera setelahnya, sebelum lanjut.

---

## 10. Batasan yang disengaja

| Batasan | Alasan |
|---|---|
| Media endpoint maks **8 MB** | Bukan soal kuota, tapi melindungi disk saat ≤32 run berjalan serentak (32 × 8 MB = 256 MB puncak) |
| Tanpa retry saat fetch gagal | Retry di dalam loop scheduler berisiko menumpuk |
| Tanpa cache respons | Untuk jadwal harian tidak perlu; optimasi prematur |
| Objek datar, tanpa nesting/array | Begitu diizinkan `{{data.santri[0].nama}}`, ini jadi bahasa query mini dan error sulit dijelaskan |
| Fetch endpoint tidak memakai kredit | Hanya pengiriman WhatsApp yang dihitung, seperti sekarang |

---

## Ringkasan jaminan

- ✅ Fitur lama **tidak berubah sama sekali** (`source_mode` default `'none'`)
- ✅ URL eksternal **tidak memotong kuota penyimpanan** — asset ber-`run_id`
  dikecualikan dari semua perhitungan
- ✅ Media diunduh **sekali per run**, bukan sekali per kontak
- ✅ Dihapus segera setelah run selesai, **apa pun hasilnya**
- ✅ Penyapu di `recover()` membersihkan sisa dari crash
- ✅ Satu run = satu snapshot, untuk teks **maupun** media
