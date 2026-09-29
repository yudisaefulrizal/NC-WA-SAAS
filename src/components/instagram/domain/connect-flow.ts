// Alur "Hubungkan Instagram": akun Instagram yang sudah ada di Zernio klien langsung dipasang sebagai sesi; akun
// baru (atau yang izinnya kedaluwarsa) login dulu lewat tautan dari Zernio, lalu dipasang saat Zernio mengalihkan
// balik. Cookie login bersifat SameSite=strict sehingga tidak ikut saat Zernio
// mengalihkan balik; pemiliknya dikenali dari token state sekali pakai yang dibuat saat alur dimulai, dan akun
// Instagram-nya dicocokkan ke API Zernio, bukan dipercaya dari parameter URL.
import { randomBytes } from 'node:crypto';
import { db } from '../../../libraries/db.js';
import { decrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { ensureBasic } from '../../billing/index.js';
import { SessionManager } from '../../whatsapp/index.js';
import { connectUrl, listInstagramAccounts, type ZernioAccount } from './zernio-client.js';
import { owned } from './zernio-accounts.js';
import * as channelsSql from '../data-access/channels-queries.js';

interface PendingConnect {
  account: string;
  zernio: string;
  session: string;
  reconnect: boolean;
  expires: number;
}
const pending = new Map<string, PendingConnect>();
const lifetimeMs = 30 * 60_000;

export async function startConnect(account: string, manager: SessionManager, body: unknown) {
  const input = object(body);
  const row = await owned(account, input.zernioId);
  SessionManager.validateId(input.sessionId);
  const session = input.sessionId,
    reconnect = input.reconnect === true;
  const existing = manager.list().find(s => s.id === session);
  let chosen: string | undefined;
  if (reconnect) {
    const [channels] = await channelsSql.findBySession(db, [account, session]);
    if (!existing || existing.channel !== 'instagram' || channels[0]?.zernio_account_id !== row.id)
      throw new ApiError(404, 'session_not_found', 'Sesi Instagram tidak ditemukan pada akun Zernio ini');
    chosen = channels[0].ig_account_id;
  } else {
    if (existing) throw new ApiError(409, 'session_exists', 'ID session sudah dipakai');
    await assertSessionSlot(account, manager);
    if (input.instagramId !== undefined) {
      if (typeof input.instagramId !== 'string' || !input.instagramId)
        throw new ApiError(400, 'invalid_request', 'Akun Instagram tidak valid');
      chosen = input.instagramId;
    }
  }
  // Akun yang masih aktif di Zernio tidak perlu login ulang.
  if (chosen) {
    const found = (await listInstagramAccounts(decrypt(row.api_key))).find(a => a._id === chosen);
    if (!found && !reconnect)
      throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ada di akun Zernio ini');
    if (found && found.isActive !== false && !found.needsReconnection) {
      const result = await attach({ account, zernio: row.id, session, reconnect }, found, manager);
      if (!result.ok) throw new ApiError(409, 'instagram_not_connected', result.message);
      return { connected: true, message: result.message };
    }
  }
  const now = Date.now();
  for (const [token, item] of pending) if (item.expires < now) pending.delete(token);
  if (pending.size >= 1000) throw new ApiError(503, 'unavailable', 'Terlalu banyak permintaan hubungkan; coba lagi');
  const token = randomBytes(24).toString('hex');
  const redirect = (process.env.APP_ORIGIN ?? 'http://127.0.0.1:8067') + '/zernio/callback?state=' + token;
  const authUrl = await connectUrl(decrypt(row.api_key), row.profile_id, redirect);
  pending.set(token, { account, zernio: row.id, session, reconnect, expires: now + lifetimeMs });
  return { authUrl };
}
// Mengembalikan pesan hasil untuk dashboard. Error apa pun di sini ditampilkan ke pemilik, bukan dilempar ke
// halaman Zernio.
export async function finishConnect(
  query: Record<string, unknown>,
  manager: (account: string) => Promise<SessionManager>,
) {
  const token = typeof query.state === 'string' ? query.state : '';
  const item = pending.get(token);
  pending.delete(token);
  if (!item || item.expires < Date.now())
    return { ok: false, message: 'Tautan hubungkan Instagram sudah kedaluwarsa. Ulangi dari halaman Sesi.' };
  if (typeof query.error === 'string') {
    const detail = typeof query.error_message === 'string' ? query.error_message.slice(0, 200) : query.error;
    return { ok: false, message: 'Instagram belum terhubung: ' + detail };
  }
  const accountId = typeof query.accountId === 'string' ? query.accountId : '';
  try {
    const row = await owned(item.account, item.zernio);
    const found = (await listInstagramAccounts(decrypt(row.api_key))).find(a => a._id === accountId);
    if (!found) return { ok: false, message: 'Akun Instagram tidak ditemukan di akun Zernio yang dipilih.' };
    return await attach(item, found, await manager(item.account));
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Instagram gagal dipasang; coba lagi.' };
  }
}
// Memasang akun Instagram (sudah dicocokkan ke API Zernio) sebagai sesi baru, atau menyambungkan ulang sesinya.
async function attach(
  item: Pick<PendingConnect, 'account' | 'zernio' | 'session' | 'reconnect'>,
  found: ZernioAccount,
  m: SessionManager,
) {
  const username = String(found.username ?? '')
    .replace(/^@/, '')
    .slice(0, 100);
  if (item.reconnect) {
    const [current] = await channelsSql.findBySession(db, [item.account, item.session]);
    if (current[0]?.ig_account_id !== found._id)
      return {
        ok: false,
        message: 'Yang login akun Instagram lain. Hubungkan ulang dengan @' + current[0]?.username + '.',
      };
    await channelsSql.updateConnection(db, [username, 'active', item.zernio, found._id]);
    if (m.detail(item.session).status === 'logged_out') await m.reconnect(item.session);
    return { ok: true, message: '@' + username + ' terhubung kembali.' };
  }
  const [linked] = await channelsSql.findByIgAccount(db, [item.zernio, found._id]);
  if (linked[0])
    return { ok: false, message: '@' + username + ' sudah terpasang sebagai sesi ' + linked[0].session_id + '.' };
  await channelsSql.insert(db, [item.account, item.session, item.zernio, found._id, username]);
  try {
    await assertSessionSlot(item.account, m);
    await m.create(item.session, 'instagram');
  } catch (error) {
    await channelsSql.deleteBySession(db, [item.account, item.session]);
    throw error;
  }
  return { ok: true, message: '@' + username + ' terhubung sebagai sesi ' + item.session + '.' };
}
// Sesi Instagram memakai jatah sesi paket yang sama dengan WhatsApp.
async function assertSessionSlot(account: string, manager: SessionManager) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const wallet = await ensureBasic(connection, account);
    await connection.commit();
    if (manager.list().filter(s => s.serviceActive !== false).length >= wallet.session_limit)
      throw new ApiError(409, 'session_limit', 'Batas nomor paket telah tercapai');
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
