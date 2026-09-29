// Webhook dari Zernio untuk satu akun Zernio klien: memeriksa tanda tangan HMAC, membuang event ganda (Zernio
// mengirim ulang sampai 7 kali), lalu meneruskan DM masuk, balasan manual dari aplikasi Instagram, dan status akun
// ke sesi Instagram yang cocok.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { db } from '../../../libraries/db.js';
import { decrypt } from '../../../libraries/crypto.js';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { ApiError } from '../../../libraries/errors.js';
import { log } from '../../../libraries/log.js';
import type { IncomingMessage, MediaType } from '../../whatsapp/index.js';
import { type ChannelHub, messageIdOf } from './channel-connection.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as contactsSql from '../data-access/contacts-queries.js';
import * as zernioSql from '../data-access/zernio-accounts-queries.js';

interface WebhookMessage {
  platform?: string;
  platformMessageId?: string;
  text?: string | null;
  attachments?: { type?: string; url?: string; mimeType?: string }[];
  sender?: { id?: string; name?: string; username?: string };
  sentAt?: string;
  sentVia?: string | null;
}
interface WebhookPayload {
  id?: string;
  event?: string;
  message?: WebhookMessage;
  conversation?: {
    platformConversationId?: string;
    participantId?: string;
    participantName?: string;
    participantUsername?: string;
  };
  account?: { accountId?: string; id?: string; username?: string };
}
const seen = new Set<string>();
const mediaTypes: Record<string, MediaType> = { image: 'image', video: 'video', audio: 'audio', file: 'document' };

export async function receiveWebhook(hub: ChannelHub, zernioId: string, raw: Buffer, signature: unknown) {
  if (!/^[0-9a-f-]{36}$/.test(zernioId)) throw new ApiError(404, 'not_found', 'Webhook tidak dikenal');
  const [rows] = await zernioSql.findById(db, [zernioId]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'Webhook tidak dikenal');
  const expected = createHmac('sha256', decrypt(row.webhook_secret)).update(raw).digest();
  const given = Buffer.from(typeof signature === 'string' ? signature : '', 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new ApiError(401, 'invalid_signature', 'Tanda tangan webhook tidak valid');
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_request', 'Body webhook bukan JSON');
  }
  await zernioSql.touchEvent(db, [zernioId]);
  if (payload.id && seen.has(payload.id)) return;
  await route(hub, zernioId, payload);
  // Dicatat setelah berhasil, supaya kiriman ulang Zernio masih diproses bila percobaan pertama gagal.
  if (payload.id) {
    seen.add(payload.id);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
  }
}
async function route(hub: ChannelHub, zernioId: string, payload: WebhookPayload) {
  const igAccount = payload.account?.accountId ?? payload.account?.id;
  if (!igAccount) return;
  const [channels] = await channelsSql.findByIgAccount(db, [zernioId, igAccount]);
  const channel = channels[0];
  if (!channel) return;
  const account = String(channel.account_id),
    session = String(channel.session_id);
  switch (payload.event) {
    case 'account.disconnected':
      await channelsSql.updateStatus(db, ['disconnected', zernioId, igAccount]);
      hub.emit(account, session, { disconnected: 401 });
      return;
    case 'account.connected':
      // Sesi yang sudah terputus tetap menunggu pemilik menekan "Hubungkan ulang"; di sini hanya status akunnya.
      await channelsSql.updateStatus(db, ['active', zernioId, igAccount]);
      return;
    case 'message.received':
    case 'message.sent': {
      const message = parse(payload);
      if (!message) return;
      if (payload.event === 'message.received') {
        await contactsSql
          .upsert(db, [
            account,
            session,
            message.from,
            String(payload.message?.sender?.username ?? payload.conversation?.participantUsername ?? '').slice(0, 100),
            String(payload.message?.sender?.name ?? payload.conversation?.participantName ?? '').slice(0, 100),
          ])
          .catch(() => log(session, 'Gagal menyimpan kontak Instagram'));
        hub.emit(account, session, { incoming: message });
      } else if (payload.message?.sentVia !== 'api') {
        // Kiriman lewat API adalah kiriman NC-WA sendiri; selain itu balasan manual dari aplikasi Instagram atau
        // inbox Zernio, yang menjeda AI seperti balasan manual dari HP WhatsApp.
        hub.emit(account, session, { outgoing: message });
      }
    }
  }
}
// DM Instagram menjadi IncomingMessage. Nomor pelanggan adalah ID pengguna Instagram (IGSID), yang di Instagram
// sama dengan platformConversationId.
function parse(payload: WebhookPayload): IncomingMessage | undefined {
  const message = payload.message;
  if (!message || message.platform !== 'instagram' || !message.platformMessageId) return;
  const customer = payload.conversation?.platformConversationId ?? payload.conversation?.participantId ?? '';
  if (!/^[0-9]{5,20}$/.test(customer)) {
    log(undefined, 'DM Instagram diabaikan: ID pengguna tidak berbentuk angka');
    return;
  }
  const timestamp = Math.floor((Date.parse(message.sentAt ?? '') || Date.now()) / 1000);
  const name = message.sender?.name || (message.sender?.username ? '@' + message.sender.username : '');
  const common = {
    messageId: messageIdOf(message.platformMessageId),
    from: customer,
    isGroup: false,
    groupId: null,
    sender: customer,
    timestamp,
    ...(name && payload.event === 'message.received' ? { pushName: name.slice(0, 100) } : {}),
  };
  const attachment = message.attachments?.[0];
  const type = attachment?.type ? mediaTypes[attachment.type] : undefined;
  if (attachment?.url && type) {
    const url = attachment.url;
    return {
      ...common,
      type,
      text: message.text ?? '',
      mimetype: attachment.mimeType ?? 'application/octet-stream',
      // Tautan CDN Meta kedaluwarsa, jadi diunduh saat pesan diproses; filenya dihapus setelah dibaca.
      download: async () => {
        const file = await downloadPublicMedia(url);
        const stream = createReadStream(file.path);
        stream.once('close', () => void file.cleanup());
        return stream;
      },
    };
  }
  const label = attachment ? '[Pesan ' + (attachment.type ?? 'lampiran') + ' Instagram]' : '';
  const text = [message.text ?? '', label].filter(Boolean).join(' ').trim();
  if (!text) return;
  return { ...common, type: 'text', text };
}
