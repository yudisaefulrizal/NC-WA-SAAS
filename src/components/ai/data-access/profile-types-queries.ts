// Query tabel ai_profile_types untuk komponen ai. Dipanggil lewat namespace, misalnya
// `profileTypesSql.listEnabled(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listEnabled(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT id FROM ai_profile_types WHERE enabled=TRUE');
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_profile_types(id,enabled) VALUES (?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)',
    params,
  );
}
