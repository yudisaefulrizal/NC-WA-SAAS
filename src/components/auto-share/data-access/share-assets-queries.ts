// Query tabel share_assets untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `shareAssetsSql.listByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,filename,mimetype,media_type,size_bytes,created_at,public_token FROM share_assets WHERE account_id=? AND run_id IS NULL ORDER BY created_at DESC',
    params,
  );
}
export function countUsage(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes FROM share_assets WHERE account_id=? AND run_id IS NULL',
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM share_assets WHERE account_id=? AND id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM share_assets WHERE account_id=? AND id=?', params);
}
export function shareOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT filename,media_type FROM share_assets WHERE account_id=? AND id=? FOR SHARE',
    params,
  );
}
