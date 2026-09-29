// Akun Zernio milik klien (boleh lebih dari satu per akun NC-WA): menambah dengan memeriksa kunci, membuat atau
// memakai profil "NC-WA", dan mendaftarkan webhook pesan masuk; memeriksa ulang, mengganti kunci, dan menghapus.
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { decrypt, encrypt } from '../../../libraries/crypto.js';
import { digest } from '../../../libraries/security.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import * as zernioClient from './zernio-client.js';
import * as channelsSql from '../data-access/channels-queries.js';
import * as zernioSql from '../data-access/zernio-accounts-queries.js';

const profileName = 'NC-WA';
export function webhookUrl(id: string) {
  return (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067') + '/zernio/webhook/' + id;
}
export async function listZernioAccounts(account: string) {
  const [rows] = await zernioSql.listByAccount(db, [account]);
  const [channels] = await channelsSql.listByAccount(db, [account]);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    key_hint: row.key_hint,
    status: row.status,
    webhook: Boolean(row.webhook_id),
    last_event_at: row.last_event_at,
    created_at: row.created_at,
    instagram: channels
      .filter(channel => channel.zernio_account_id === row.id)
      .map(channel => ({ session: channel.session_id, username: channel.username, status: channel.status })),
  }));
}
export async function addZernioAccount(account: string, body: unknown) {
  const input = object(body);
  const name = accountName(input.name),
    key = apiKey(input.apiKey);
  const hash = digest(key);
  const [taken] = await zernioSql.findByKeyHash(db, [hash]);
  if (taken[0]) throw new ApiError(409, 'zernio_exists', 'Kunci API Zernio ini sudah terpasang');
  const profiles = await zernioClient.listProfiles(key);
  const profile = profiles.find(p => p.name === profileName) ?? (await zernioClient.createProfile(key, profileName));
  const id = randomUUID(),
    secret = randomBytes(32).toString('hex');
  const webhookId = await zernioClient.createWebhook(key, {
    name: profileName + ' ' + id.slice(0, 8),
    url: webhookUrl(id),
    secret,
    profileId: profile._id,
  });
  try {
    await zernioSql.insert(db, [
      id,
      account,
      name,
      encrypt(key),
      hash,
      key.slice(-4),
      profile._id,
      webhookId,
      encrypt(secret),
    ]);
  } catch (error) {
    // Webhook yang sudah terdaftar dibersihkan lagi supaya akun Zernio klien tidak menumpuk webhook yatim.
    await zernioClient.deleteWebhook(key, webhookId).catch(() => {});
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
      throw new ApiError(409, 'zernio_exists', 'Nama atau kunci akun Zernio sudah dipakai');
    throw error;
  }
  return { id };
}
// Memeriksa kunci masih berlaku dan webhook masih terdaftar; webhook yang hilang didaftarkan ulang.
export async function checkZernioAccount(account: string, id: string) {
  const row = await owned(account, id);
  const key = decrypt(row.api_key);
  try {
    const profiles = await zernioClient.listProfiles(key);
    if (!profiles.some(p => p._id === row.profile_id))
      throw new ApiError(
        409,
        'zernio_profile_missing',
        'Profil NC-WA di Zernio tidak ditemukan; tambahkan ulang akun ini',
      );
    const webhooks = await zernioClient.listWebhooks(key);
    if (!webhooks.some(w => w._id === row.webhook_id && w.isActive !== false)) {
      const secret = randomBytes(32).toString('hex');
      const webhookId = await zernioClient.createWebhook(key, {
        name: profileName + ' ' + id.slice(0, 8),
        url: webhookUrl(id),
        secret,
        profileId: row.profile_id,
      });
      if (row.webhook_id) await zernioClient.deleteWebhook(key, row.webhook_id).catch(() => {});
      await zernioSql.updateWebhook(db, [webhookId, encrypt(secret), id, account]);
    } else await zernioSql.updateStatus(db, ['active', id, account]);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'zernio_unauthorized')
      await zernioSql.updateStatus(db, ['invalid', id, account]);
    throw error;
  }
  return { ok: true };
}
// Kunci pengganti harus dari akun Zernio yang sama (melihat profil NC-WA yang sama), supaya sesi Instagram yang
// sudah terpasang tetap bisa mengirim.
export async function replaceZernioKey(account: string, id: string, body: unknown) {
  const row = await owned(account, id);
  const key = apiKey(object(body).apiKey);
  const profiles = await zernioClient.listProfiles(key);
  if (!profiles.some(p => p._id === row.profile_id))
    throw new ApiError(409, 'zernio_other_account', 'Kunci ini milik akun Zernio lain; tambahkan sebagai akun baru');
  const hash = digest(key);
  const [taken] = await zernioSql.findByKeyHash(db, [hash]);
  if (taken[0] && taken[0].id !== id) throw new ApiError(409, 'zernio_exists', 'Kunci API Zernio ini sudah terpasang');
  await zernioSql.updateKey(db, [encrypt(key), hash, key.slice(-4), id, account]);
  return { ok: true };
}
// Sesi Instagram milik akun ini dihapus oleh pemanggil sebelum barisnya; webhook di Zernio dihapus bila masih bisa.
export async function sessionsOfZernioAccount(account: string, id: string) {
  await owned(account, id);
  const [rows] = await channelsSql.listByZernio(db, [id, account]);
  return rows.map(row => String(row.session_id));
}
export async function deleteZernioAccount(account: string, id: string) {
  const row = await owned(account, id);
  if (row.webhook_id) await zernioClient.deleteWebhook(decrypt(row.api_key), row.webhook_id).catch(() => {});
  await zernioSql.deleteOwned(db, [id, account]);
  return { deleted: true };
}
export async function owned(account: string, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))
    throw new ApiError(404, 'zernio_not_found', 'Akun Zernio tidak ditemukan');
  const [rows] = await zernioSql.findOwned(db, [id, account]);
  if (!rows[0]) throw new ApiError(404, 'zernio_not_found', 'Akun Zernio tidak ditemukan');
  return rows[0];
}
function accountName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60)
    throw new ApiError(400, 'invalid_request', 'Nama akun Zernio wajib diisi, maksimal 60 karakter');
  return value.trim();
}
function apiKey(value: unknown) {
  if (typeof value !== 'string' || !/^sk_[A-Za-z0-9_-]{8,300}$/.test(value.trim()))
    throw new ApiError(400, 'invalid_request', 'Kunci API Zernio diawali sk_ dan tanpa spasi');
  return value.trim();
}
