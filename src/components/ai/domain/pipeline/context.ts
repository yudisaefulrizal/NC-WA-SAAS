// Ringkasan S-P-O node Context graf tentang posisi percakapan (panjangnya mengikuti instruksi global). Yang dikirim ke
// model hanya instruksi global dan pasangan pesan terakhir (Pelanggan/AI) sebagai transkrip pendek,
// bukan seluruh riwayat, supaya hemat dan mudah dipahami model murah.
import type { AIConfig, AITransport } from '../provider.js';
import { validatedAI } from './retry.js';

// Instruksi global node Context, persis hasil riset pemilik; jangan ditambah. Tidak diatur per profil; isi prompt node
// Context di profil lama diabaikan.
export const contextInstruction = `ubah percakapan jadi 1 konteks hanya SPO (subjek objek predikat jelas dan ekplisit) dalam dua kalimat singkat tanpa keterangan tambahan:
contoh:
user: Assalamu'alaikum, ada program apa saja di ma'had?
AI: Wa'alaikumussalam. Program pendidikan yang tersedia adalah Madrasah, Darul Ilmi, Ma'had Aly, dan Mahdon Tarbawi. Setiap program memiliki jenjang dan target pembelajaran yang berbeda. Untuk detail program tertentu, silakan sebutkan nama programnya.
hasil: Wali menanyakan program pendidikan Ma’had. AI menyebutkan Madrasah, Darul Ilmi, Ma’had Aly, dan Mahdon Tarbawi.`;
// Pengaman teknis agar ringkasan yang kebablasan tidak ikut terkirim ke Router di setiap pesan berikutnya.
export const maxContextChars = 4000;
// Tanda baca boleh; baris baru digabung jadi satu baris; kutip pembungkus dan pagar kode dibuang.
export function cleanContext(raw: string) {
  return raw
    .replace(/```[a-z]*|```/gi, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .trim()
    .slice(0, maxContextChars);
}
export function summarizeSPO(transport: AITransport, config: AIConfig, userMessage: string, answer: string) {
  return validatedAI(
    transport,
    config,
    [
      { role: 'system', content: contextInstruction },
      { role: 'user', content: 'Pelanggan: ' + userMessage + '\n\nAI: ' + answer },
    ],
    60,
    raw => {
      const result = cleanContext(raw);
      if (!result) throw Error('ai_invalid_context');
      return result;
    },
    // Koreksi bila jawaban kosong: instruksi yang sama, tanpa tambahan.
    contextInstruction,
  );
}
