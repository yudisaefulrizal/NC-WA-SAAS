// Memori percakapan AI (ai_conversations.messages) tersimpan sebagai JSON; MySQL bisa mengembalikannya sebagai
// teks atau sebagai objek, tergantung jalur query-nya.
import { AIMessage } from './provider.js';

export function parseMemory(value: unknown): AIMessage[] {
  return (typeof value === 'string' ? JSON.parse(value) : value) as AIMessage[];
}
