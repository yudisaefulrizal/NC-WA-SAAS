// Riwayat chat WhatsApp lengkap untuk tampilan Percakapan di dashboard. Terpisah dari memori AI
// (ai_conversations.messages), yang dipangkas sesuai batas memori dan dikosongkan oleh "Hapus konteks".
import { randomUUID } from 'node:crypto';
import { db, type Executor } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import type { IncomingMessage } from '../../whatsapp/index.js';
import * as chatMessagesSql from '../data-access/chat-messages-queries.js';
import * as conversationsSql from '../data-access/conversations-queries.js';
export type ChatOrigin = 'customer' | 'ai' | 'manual' | 'api' | 'system';
export type ChatStatus = 'sent' | 'delivered' | 'read';
let notify: (account: string, session: string, customer: string) => void = () => {};
// Gateway meneruskan perubahan ke aliran realtime dashboard.
export function onChatChange(listener: typeof notify) {
  notify = listener;
}

const customerPattern = /^[0-9]{5,20}$/;
const mediaLabels: Record<string, string> = { image: 'Gambar', video: 'Video', audio: 'Audio', document: 'Dokumen' };
export function customerOf(address: string) {
  const digits = address.split('@')[0].split(':')[0];
  return !address.endsWith('@g.us') && customerPattern.test(digits) ? digits : null;
}
function describe(type: string, text: string) {
  const body = text.trim();
  return type === 'text' ? body : body || '[' + (mediaLabels[type] ?? 'Pesan ' + type) + ']';
}

export async function recordIncoming(account: string, session: string, message: IncomingMessage) {
  if (message.isGroup || !customerPattern.test(message.from)) return;
  await chatMessagesSql.insertIgnore(db, [
    account,
    session,
    message.from,
    message.messageId,
    message.type,
    describe(message.type, message.text).slice(0, 8000),
  ]);
  notify(account, session, message.from);
}
// Setiap kiriman awalnya dicatat umum ("api"); pemanggil yang lebih tahu (AI, balasan dashboard) menimpa dengan
// asal yang tepat, dan catatan umum yang datang belakangan tidak pernah menurunkannya. Mana pun yang tiba duluan,
// hasilnya sama.
export async function recordOutgoing(
  account: string,
  session: string,
  input: { customer: string; messageId: string; origin: ChatOrigin; type?: string; text: string },
  executor: Executor = db,
) {
  if (!customerPattern.test(input.customer)) return;
  const type = input.type ?? 'text';
  await chatMessagesSql.upsertOutgoing(executor, [
    account,
    session,
    input.customer,
    input.messageId,
    input.origin,
    type,
    describe(type, input.text).slice(0, 8000),
  ]);
  notify(account, session, input.customer);
}
// Catatan yang ditulis di milidetik yang sama (misalnya "dilanjutkan" dan "full auto aktif" dalam satu perubahan)
// tetap berurutan: riwayat diurutkan menurut created_at lalu message_id, jadi id catatan disusun dari waktu, nomor
// urut, dan ekor acak.
let noteSequence = 0;
export async function recordNote(
  account: string,
  session: string,
  customer: string,
  text: string,
  executor: Executor = db,
) {
  const id =
    'note-' +
    String(Date.now()).padStart(15, '0') +
    '-' +
    String((noteSequence = (noteSequence + 1) % 1e6)).padStart(6, '0') +
    '-' +
    randomUUID().slice(0, 8);
  await chatMessagesSql.insertNote(executor, [account, session, customer, id, text]);
  notify(account, session, customer);
}
// Status hanya bergerak maju: terkirim → sampai → dibaca.
export async function updateStatus(account: string, session: string, messageId: string, status: ChatStatus) {
  const [rows] = await chatMessagesSql.findCustomerOfOutgoing(db, [account, session, messageId, status]);
  if (!rows[0]) return;
  await chatMessagesSql.updateStatus(db, [status, account, session, messageId, status]);
  notify(account, session, rows[0].customer);
}

// Daftar percakapan: setiap pelanggan yang punya riwayat atau percakapan AI, aktivitas terbaru di atas.
export async function listChats(account: string, session: string) {
  const [latest] = await chatMessagesSql.listLatestPerCustomer(db, [account, session]);
  const [conversations] = await conversationsSql.listFirst200BySession(db, [account, session]);
  const byCustomer = new Map<string, Record<string, unknown>>();
  for (const row of conversations)
    byCustomer.set(row.customer, {
      customer: row.customer,
      paused: Boolean(row.paused),
      full_auto: Boolean(row.full_auto),
      message_count: Number(row.message_count ?? 0),
      router_context: row.router_context ?? null,
      last: null,
    });
  for (const row of latest) {
    const entry: Record<string, unknown> = byCustomer.get(row.customer) ?? {
      customer: row.customer,
      paused: false,
      full_auto: false,
      message_count: 0,
      router_context: null,
    };
    entry.last = { text: row.text, direction: row.direction, origin: row.origin, type: row.type, at: row.created_at };
    byCustomer.set(row.customer, entry);
  }
  const time = (entry: Record<string, unknown>) => {
    const last = entry.last as { at: Date } | null;
    return last ? new Date(last.at).getTime() : 0;
  };
  return [...byCustomer.values()]
    .sort((a, b) => time(b) - time(a) || String(a.customer).localeCompare(String(b.customer)))
    .slice(0, 300);
}

// Halaman terbaru diambil lebih dulu dari database, dikembalikan urut dari terlama ke terbaru. `before` adalah
// kursor pesan tertua yang sedang tampil.
export async function chatMessages(account: string, session: string, customer: string, before?: unknown) {
  if (!customerPattern.test(customer)) throw new ApiError(400, 'invalid_request', 'Nomor pelanggan tidak valid');
  let cursor: [Date, string] | undefined;
  if (before !== undefined) {
    const match = typeof before === 'string' ? /^(\d{1,15})_(.{1,128})$/.exec(before) : null;
    if (!match) throw new ApiError(400, 'invalid_request', 'Cursor tidak valid');
    cursor = [new Date(Number(match[1])), match[2]];
  }
  const [rows] = await chatMessagesSql.listPage(
    db,
    [account, session, customer, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : [])],
    cursor,
  );
  const more = rows.length > 100,
    page = rows.slice(0, 100).reverse();
  const oldest = page[0];
  return {
    messages: page.map(row => ({
      id: row.message_id,
      direction: row.direction,
      origin: row.origin,
      type: row.type,
      text: row.text,
      status: row.status,
      at: row.created_at,
    })),
    before: more && oldest ? new Date(oldest.created_at).getTime() + '_' + oldest.message_id : null,
  };
}
