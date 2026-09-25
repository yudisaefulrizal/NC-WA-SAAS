// Query tabel accounts untuk komponen ai. Dipanggil lewat namespace, misalnya
// `accountsSql.lockSuspended(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockSuspended(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT suspended FROM accounts WHERE id=? FOR UPDATE', params);
}
export function lockWithSuspended(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id,suspended FROM accounts WHERE id=? FOR UPDATE', params);
}
