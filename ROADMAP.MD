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
