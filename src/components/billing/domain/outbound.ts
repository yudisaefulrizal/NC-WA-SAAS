// Mengirim satu pesan WhatsApp yang memotong kredit: reservasi, kirim, catat hasil, lalu selesaikan kredit.
// Hasil kirim yang tidak pasti tidak pernah dikirim ulang otomatis.
import { randomUUID } from 'node:crypto';
import { digest } from '../../../libraries/security.js';
import { reserveCredit, settleCredit, validateReservation } from './credits.js';
import { type SessionManager, recipient, type MediaType, type Outbound } from '../../whatsapp/index.js';
import { ApiError } from '../../../libraries/errors.js';
import { object, requiredString } from '../../../libraries/validation.js';
import { downloadPublicMedia } from '../../../libraries/download.js';
import { db } from '../../../libraries/db.js';
import * as outboundResultsSql from '../data-access/outbound-results-queries.js';

export async function sendBilled(
  accountId: string,
  manager: SessionManager,
  id: string,
  kind: 'text' | 'media',
  body: unknown,
  key?: string,
  download = downloadPublicMedia,
  beforeDispatch?: () => Promise<void>,
) {
  const input = object(body),
    jid = recipient(input.to);
  let content: Outbound;
  if (kind === 'text') content = { text: requiredString(input.text, 'text') };
  else {
    const type = requiredString(input.type, 'type');
    if (!['image', 'document', 'audio', 'video'].includes(type))
      throw new ApiError(400, 'invalid_request', 'Jenis media tidak valid');
    content = {
      type: type as MediaType,
      url: requiredString(input.url, 'url', 4096),
      caption: input.caption === undefined ? undefined : requiredString(input.caption, 'caption'),
      filename: input.filename === undefined ? undefined : requiredString(input.filename, 'filename', 255),
    };
  }
  const requestId = key ?? randomUUID();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
    throw new ApiError(
      400,
      'invalid_request',
      'Idempotency-Key harus 1–128 huruf, angka, garis bawah atau tanda hubung',
    );
  manager.detail(id);
  let reservation;
  try {
    reservation = await reserveCredit(accountId, requestId, digest(JSON.stringify({ id, jid, content })));
  } catch (error) {
    const code = (error as Error).message;
    if (['insufficient_credits', 'idempotency_conflict'].includes(code))
      throw new ApiError(
        409,
        code,
        code === 'insufficient_credits' ? 'Kredit habis.' : 'ID permintaan sudah digunakan untuk payload lain.',
      );
    throw error;
  }
  if (!reservation.created) {
    const [rows] = await outboundResultsSql.findRequest(db, [accountId, requestId]);
    if (rows[0]) return { messageId: rows[0].message_id, to: rows[0].recipient, requestId };
    throw new ApiError(
      409,
      'request_' + reservation.status,
      'Permintaan sudah tercatat; tidak dikirim ulang. Periksa riwayat pemakaian.',
    );
  }
  let file: Awaited<ReturnType<typeof downloadPublicMedia>> | undefined;
  let accepted = false;
  try {
    manager.connected(id);
    if ('url' in content) {
      file = await download(content.url);
      content = { ...content, url: file.path, mimetype: file.mimetype };
    }
    const result = await manager.send(id, jid, content, async () => {
      await beforeDispatch?.();
      try {
        await validateReservation(accountId, requestId);
      } catch (error) {
        if ((error as Error).message === 'reservation_expired')
          throw new ApiError(409, 'reservation_expired', 'Periode kredit berakhir sebelum pesan dikirim');
        throw error;
      }
    });
    accepted = true;
    // Bukti kirim disimpan sebelum kredit diselesaikan, jadi crash tidak pernah memicu kirim ulang otomatis.
    await outboundResultsSql.insert(db, [accountId, requestId, result.messageId, result.to]);
    await settleCredit(accountId, requestId, 'sent');
    return { ...result, requestId };
  } catch (error) {
    const uncertain = accepted || (error instanceof ApiError && error.code === 'send_unknown');
    await settleCredit(accountId, requestId, uncertain ? 'unknown' : 'failed');
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      uncertain ? 'send_unknown' : 'send_failed',
      uncertain ? 'Hasil pengiriman belum pasti; jangan kirim ulang.' : 'Pengiriman gagal sebelum diterima transport.',
    );
  } finally {
    await file?.cleanup();
  }
}
