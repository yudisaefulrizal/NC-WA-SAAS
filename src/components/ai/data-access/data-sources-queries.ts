// Query tabel ai_data_sources untuk komponen ai. Dipanggil lewat namespace, misalnya
// `dataSourcesSql.find(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT mode,endpoint,secret FROM ai_data_sources WHERE account_id=? AND data_profile_id=? AND kind=?',
    params,
  );
}
export function findEndpoint(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT endpoint,secret FROM ai_data_sources WHERE account_id=? AND data_profile_id=? AND kind=?',
    params,
  );
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_data_sources(account_id,data_profile_id,kind,mode,endpoint,secret) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),endpoint=VALUES(endpoint),secret=VALUES(secret)',
    params,
  );
}
export function copyToProfile(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_data_sources(account_id,data_profile_id,kind,mode,endpoint,secret) SELECT account_id,?,kind,mode,endpoint,secret FROM ai_data_sources WHERE account_id=? AND data_profile_id=?',
    params,
  );
}
