// Query tabel wallets untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `walletsSql.findShareLimits(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findShareLimits(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.max_share_assets,p.max_share_storage_bytes FROM wallets w JOIN plans p ON p.id=w.plan_id WHERE w.account_id=?',
    params,
  );
}
