// Query tabel accounts untuk komponen billing. Dipanggil lewat namespace, misalnya
// `accountsSql.lock(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM accounts WHERE id=? FOR UPDATE', params);
}
export function listDueForRenewal(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT a.id FROM accounts a LEFT JOIN wallets w ON w.account_id=a.id WHERE a.id>? AND (w.account_id IS NULL OR (w.plan_id='basic' AND w.period<?) OR w.expires_at<=?) ORDER BY a.id LIMIT 100`,
    params,
  );
}
