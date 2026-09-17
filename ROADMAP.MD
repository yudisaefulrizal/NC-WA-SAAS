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
