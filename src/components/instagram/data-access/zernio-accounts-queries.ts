// Query tabel instagram_zernio_accounts. Dipanggil lewat namespace, misalnya `zernioSql.findOwned(db, [...])`;
// argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO instagram_zernio_accounts(id,account_id,name,api_key,key_hash,key_hint,profile_id,webhook_id,webhook_secret) VALUES (?,?,?,?,?,?,?,?,?)',
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,name,key_hint,profile_id,webhook_id,status,last_event_at,created_at FROM instagram_zernio_accounts WHERE account_id=? ORDER BY created_at,id',
    params,
  );
}
export function findOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM instagram_zernio_accounts WHERE id=? AND account_id=?', params);
}
export function findById(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM instagram_zernio_accounts WHERE id=?', params);
}
export function findByKeyHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM instagram_zernio_accounts WHERE key_hash=?', params);
}
export function updateKey(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>(
    "UPDATE instagram_zernio_accounts SET api_key=?,key_hash=?,key_hint=?,status='active' WHERE id=? AND account_id=?",
    params,
  );
}
export function updateWebhook(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE instagram_zernio_accounts SET webhook_id=?,webhook_secret=?,status='active' WHERE id=? AND account_id=?",
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE instagram_zernio_accounts SET status=? WHERE id=? AND account_id=?', params);
}
export function touchEvent(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE instagram_zernio_accounts SET last_event_at=UTC_TIMESTAMP() WHERE id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_zernio_accounts WHERE id=? AND account_id=?', params);
}
