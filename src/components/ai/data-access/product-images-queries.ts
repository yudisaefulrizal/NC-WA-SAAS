// Query tabel ai_product_images untuk komponen ai. Dipanggil lewat namespace, misalnya
// `productImagesSql.findInProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findInProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM ai_product_images WHERE id=? AND account_id=? AND data_profile_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO ai_product_images(id,account_id,data_profile_id,size_bytes) VALUES (?,?,?,?)', params);
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<any[]>('SELECT id FROM ai_product_images WHERE account_id=? AND id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_product_images WHERE account_id=? AND id=?', params);
}
export function listByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM ai_product_images WHERE account_id=? AND data_profile_id=?',
    params,
  );
}
