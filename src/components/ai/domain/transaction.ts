// Transaksi database untuk operasi AI, dan kunci baris akun yang mengantrekan semua perubahan satu akun.
import type { PoolConnection } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import * as accountsSql from '../data-access/accounts-queries.js';

export async function transaction<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}

// settling=true untuk pekerjaan yang harus tetap tuntas walau akun baru saja dinonaktifkan: menyelesaikan
// tagihan yang sudah berjalan, mencatat balasan, dan menghapus data sesi.
export async function lockAccount(c: PoolConnection, account: string, settling = false) {
  const [rows] = await accountsSql.lockWithSuspended(c, [account]);
  if (!rows[0] || (!settling && rows[0].suspended))
    throw new ApiError(403, 'account_unavailable', 'Akun tidak tersedia');
}
