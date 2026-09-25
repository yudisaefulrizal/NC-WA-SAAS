// Bidang knowledge CS Usaha dan cara menyusunnya menjadi teks untuk agent.
// Produk dan harga ada di tabel produk (cs/store.ts), bukan di teks bebas ini. Nama, deskripsi, alamat, kontak,
// dan jam operasional digabung ke satu bidang "usaha"; hal yang tidak cocok di bidang lain masuk ke FAQ.
import { text } from '../../input-validation.js';
export const profileFields = ['usaha', 'cara_pemesanan', 'pembayaran', 'kebijakan', 'faq'] as const;
export type ProfileField = (typeof profileFields)[number];
export const profileLabels: Record<ProfileField, string> = {
  usaha: 'Profil usaha',
  cara_pemesanan: 'Cara pemesanan',
  pembayaran: 'Metode pembayaran',
  kebijakan: 'Kebijakan',
  faq: 'FAQ',
};
// Hanya bidang yang terisi yang dikirim ke agent; bidang kosong tidak menambah gangguan di prompt.
export function composeKnowledge(profile: Partial<Record<ProfileField, string>>) {
  return profileFields
    .map(field => {
      const value = profile[field]?.trim();
      return value ? profileLabels[field] + ': ' + value : null;
    })
    .filter(Boolean)
    .join('\n\n');
}
