// Query tabel auto_share_settings untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `settingsSql.findAutoAdd(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findAutoAdd(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT auto_add_enabled FROM auto_share_settings WHERE account_id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO auto_share_settings(account_id,auto_add_enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE auto_add_enabled=VALUES(auto_add_enabled)',
    params,
  );
}
