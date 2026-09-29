// Alur "Hubungkan Instagram": akun Instagram yang sudah terhubung di Zernio klien dipasang sebagai sesi, atau sesi
// yang terputus disambungkan lagi. Login Instagram tidak pernah dilakukan dari NC-WA: menambah atau menghubungkan
// ulang akun dilakukan klien di dashboard Zernio (satu profil Zernio hanya memuat satu Instagram, dan login ke
// profil yang terisi menghapus data akun lamanya).
import { db } from '../../../libraries/db.js';
import { decrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { ensureBasic } from '../../billing/index.js';
import { SessionManager } from '../../whatsapp/index.js';
import { listInstagramAccounts } from './zernio-client.js';
import { owned } from './zernio-accounts.js';
import * as channelsSql from '../data-access/channels-queries.js';

export async function connectInstagram(account: string, manager: SessionManager, body: unknown) {
  const input = object(body);
  const row = await owned(account, input.zernioId);
  SessionManager.validateId(input.sessionId);
  const session = input.sessionId;
  if (manager.list().some(s => s.id === session)) throw new ApiError(409, 'session_exists', 'ID session sudah dipakai');
  if (typeof input.instagramId !== 'string' || !input.instagramId)
    throw new ApiError(400, 'invalid_request', 'Pilih akun Instagram');
  await assertSessionSlot(account, manager);
  const found = (await listInstagramAccounts(decrypt(row.api_key))).find(a => a._id === input.instagramId);
  if (!found) throw new ApiError(404, 'instagram_not_found', 'Akun Instagram tidak ada di akun Zernio ini');
  const username = usernameOf(found.username);
  if (found.isActive === false || found.needsReconnection)
    throw new ApiError(
      409,
      'instagram_disconnected',
      '@' + username + ' terputus di Zernio; hubungkan ulang di Zernio dulu',
    );
  const [linked] = await channelsSql.findByIgAccount(db, [row.id, found._id]);
  if (linked[0])
    throw new ApiError(
      409,
      'instagram_in_use',
      '@' + username + ' sudah terpasang sebagai sesi ' + linked[0].session_id,
    );
  await channelsSql.insert(db, [account, session, row.id, found._id, username]);
  try {
    await assertSessionSlot(account, manager);
    await manager.create(session, 'instagram');
  } catch (error) {
    await channelsSql.deleteBySession(db, [account, session]);
    throw error;
  }
  return { message: '@' + username + ' terhubung sebagai sesi ' + session + '.' };
}
// Menyambungkan lagi sesi yang terputus, bila akunnya sudah aktif kembali di Zernio.
export async function reconnectInstagram(account: string, manager: SessionManager, session: unknown) {
  SessionManager.validateId(session);
  const [channels] = await channelsSql.findBySession(db, [account, session]);
  const channel = channels[0];
  if (!channel || manager.list().find(s => s.id === session)?.channel !== 'instagram')
    throw new ApiError(404, 'session_not_found', 'Sesi Instagram tidak ditemukan');
  const found = (await listInstagramAccounts(decrypt(channel.api_key))).find(a => a._id === channel.ig_account_id);
  if (!found || found.isActive === false || found.needsReconnection)
    throw new ApiError(
      409,
      'instagram_disconnected',
      '@' +
        channel.username +
        ' masih terputus di Zernio. Hubungkan ulang akunnya di dashboard Zernio, lalu coba lagi.',
    );
  const username = usernameOf(found.username);
  await channelsSql.updateConnection(db, [username, 'active', channel.zernio_account_id, found._id]);
  if (manager.detail(session).status === 'logged_out') await manager.reconnect(session);
  return { message: '@' + username + ' terhubung kembali.' };
}
function usernameOf(value: unknown) {
  return String(value ?? '')
    .replace(/^@/, '')
    .slice(0, 100);
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
