// Query tabel ai_products untuk komponen ai. Dipanggil lewat namespace, misalnya
// `productsSql.listByProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByProfile(c: Executor, params: SqlValue[], activeOnly: boolean) {
  return c.execute<RowDataPacket[]>(
    'SELECT name,type,description,price,stock,active,image_id FROM ai_products WHERE account_id=? AND data_profile_id=?' +
      (activeOnly ? ' AND active=TRUE' : '') +
      ' AND name LIKE ? ORDER BY name LIMIT ' +
      (activeOnly ? '20' : '200'),
    params,
  );
}
export function deleteByName(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_products WHERE account_id=? AND data_profile_id=? AND name=?', params);
}
export function findImageId(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT image_id FROM ai_products WHERE account_id=? AND data_profile_id=? AND name=?',
    params,
  );
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_products(account_id,data_profile_id,name,type,description,price,stock,active,image_id) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE type=VALUES(type),description=VALUES(description),price=VALUES(price),stock=VALUES(stock),active=VALUES(active),image_id=VALUES(image_id)',
    params,
  );
}
export function listAllByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM ai_products WHERE account_id=? AND data_profile_id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_products(account_id,data_profile_id,name,type,description,price,stock,active,image_id) VALUES (?,?,?,?,?,?,?,?,?)',
    params,
  );
}
