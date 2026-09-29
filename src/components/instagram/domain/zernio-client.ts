// Pemanggil API Zernio (https://docs.zernio.com) dengan kunci API milik klien: profil, webhook, tautan login
// Instagram, daftar akun, dan kirim DM. Kunci tidak pernah dicatat; kegagalan diubah menjadi ApiError berbahasa
// Indonesia. Alamat API bisa diganti lewat ZERNIO_API_URL (dipakai tes dengan server tiruan).
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { ApiError } from '../../../libraries/errors.js';

export interface ZernioProfile {
  _id: string;
  name: string;
  isDefault?: boolean;
}
export interface ZernioAccount {
  _id: string;
  platform: string;
  username: string;
  displayName?: string;
  profileId: string | { _id: string };
  isActive?: boolean;
  needsReconnection?: boolean;
}
// Jenis lampiran dibaca Zernio dari isi file unggahan; form multipart-nya tidak punya kolom jenis.
export type ZernioAttachment = { path: string; filename?: string };

const timeoutMs = 20_000;
function baseUrl() {
  return (process.env.ZERNIO_API_URL ?? 'https://zernio.com/api').replace(/\/+$/, '');
}
// Satu panggilan API. Body objek dikirim sebagai JSON, FormData apa adanya (unggah lampiran).
export async function zernio<T>(
  key: string,
  method: string,
  path: string,
  body?: Record<string, unknown> | FormData,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(baseUrl() + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch {
    throw new ApiError(502, 'zernio_unavailable', 'Zernio tidak bisa dihubungi; coba lagi sebentar lagi');
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return data as T;
  if (response.status === 401)
    throw new ApiError(400, 'zernio_unauthorized', 'Kunci API Zernio tidak valid atau sudah dicabut');
  // Pesan dari Zernio ikut ditampilkan (tanpa kunci), supaya klien tahu apa yang harus diperbaiki di sana.
  const detail = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
  throw new ApiError(
    502,
    'zernio_failed',
    'Zernio menolak permintaan (' + response.status + ')' + (detail ? ': ' + detail.slice(0, 200) : ''),
  );
}
export async function listProfiles(key: string) {
  return (await zernio<{ profiles?: ZernioProfile[] }>(key, 'GET', '/v1/profiles?limit=100')).profiles ?? [];
}
export async function listWebhooks(key: string) {
  const data = await zernio<{ webhooks?: { _id: string; url: string; isActive?: boolean }[] }>(
    key,
    'GET',
    '/v1/webhooks/settings',
  );
  return data.webhooks ?? [];
}
// Webhook untuk seluruh akun Zernio klien, tanpa dibatasi profil: susunan profil adalah urusan klien, dan yang
// dibalas NC-WA hanya akun Instagram yang dipasang sebagai sesi.
export async function createWebhook(key: string, input: { name: string; url: string; secret: string }) {
  const data = await zernio<{ webhook?: { _id: string } }>(key, 'POST', '/v1/webhooks/settings', {
    name: input.name,
    url: input.url,
    secret: input.secret,
    events: ['message.received', 'message.sent', 'account.connected', 'account.disconnected'],
    isActive: true,
  });
  if (!data.webhook?._id) throw new ApiError(502, 'zernio_failed', 'Zernio tidak mengembalikan webhook');
  return data.webhook._id;
}
export async function deleteWebhook(key: string, id: string) {
  await zernio(key, 'DELETE', '/v1/webhooks/settings?webhookId=' + encodeURIComponent(id));
}
// Semua akun Instagram di akun Zernio klien, dari profil mana pun.
export async function listInstagramAccounts(key: string) {
  const query = new URLSearchParams({ platform: 'instagram' });
  return (await zernio<{ accounts?: ZernioAccount[] }>(key, 'GET', '/v1/accounts?' + query)).accounts ?? [];
}
// Mengirim DM. Pada Instagram, ID pengguna (IGSID) diterima Zernio sebagai conversationId, jadi tidak perlu
// mencari percakapan dulu. Mengembalikan ID pesan platform (mid).
export async function sendMessage(
  key: string,
  accountId: string,
  recipient: string,
  text: string,
  attachment?: ZernioAttachment,
) {
  const path = '/v1/inbox/conversations/' + encodeURIComponent(recipient) + '/messages';
  let body: Record<string, unknown> | FormData;
  if (attachment) {
    body = new FormData();
    body.set('accountId', accountId);
    if (text) body.set('message', text);
    body.set('attachment', await openAsBlob(attachment.path), attachment.filename ?? basename(attachment.path));
  } else body = { accountId, message: text };
  const data = await zernio<{ data?: { messageId?: string } }>(key, 'POST', path, body);
  if (!data.data?.messageId) throw new ApiError(502, 'zernio_failed', 'Zernio tidak mengembalikan ID pesan');
  return data.data.messageId;
}
