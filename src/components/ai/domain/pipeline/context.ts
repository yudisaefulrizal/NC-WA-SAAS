// Kontrak ringkasan S-P-O yang dipakai bersama oleh pipeline bawaan dan node Context graf.
import type { AIConfig, AIMessage, AITransport } from '../provider.js';
import { validatedAI } from './retry.js';

export function summarizeSPO(
  transport: AITransport,
  config: AIConfig,
  prompt: string,
  userMessage: string,
  answer: string,
  history: readonly AIMessage[],
) {
  return validatedAI(
    transport,
    config,
    [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          riwayat_sebelumnya: history.map(m => ({ peran: m.role, isi: m.content })),
          pesan_pelanggan: userMessage,
          jawaban_agent: answer,
        }),
      },
    ],
    30,
    raw => {
      const result = raw.trim();
      if (result.length > 200 || !/^[\p{L}\p{N}_ ]+(-[\p{L}\p{N}_ ]+){2,}$/u.test(result))
        throw Error('ai_invalid_context');
      return result;
    },
    'Kembalikan satu baris Subjek-Predikat-Objek dipisahkan tanda hubung, minimal tiga kata, maksimal 200 karakter, tanpa penjelasan atau JSON.',
  );
}
