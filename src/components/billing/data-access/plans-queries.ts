// Query tabel plans untuk komponen billing. Dipanggil lewat namespace, misalnya
// `plansSql.listPublic(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listPublic(c: Executor) {
  return c.query('SELECT id,name,price,credits,session_limit FROM plans WHERE active=TRUE');
}
export function listActive(c: Executor) {
  return c.query('SELECT * FROM plans WHERE active=TRUE');
}
export function listAll(c: Executor) {
  return c.query('SELECT * FROM plans');
}
export function deleteById(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM plans WHERE id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO plans VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),credits=VALUES(credits),session_limit=VALUES(session_limit),active=VALUES(active),max_share_assets=VALUES(max_share_assets),max_share_storage_bytes=VALUES(max_share_storage_bytes)',
    params,
  );
}
export function sharePurchasable(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM plans WHERE id=? AND active=TRUE AND price>0 FOR SHARE', params);
}
export function findBasicQuota(c: Executor) {
  return c.query<RowDataPacket[]>("SELECT credits,session_limit FROM plans WHERE id='basic'");
}
