// Query tabel instagram_channels: akun Instagram yang terpasang sebagai sesi. Dipanggil lewat namespace, misalnya
// `channelsSql.findBySession(db, [...])`.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO instagram_channels(account_id,session_id,zernio_account_id,ig_account_id,username) VALUES (?,?,?,?,?)',
    params,
  );
}
export function findBySession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT c.*,z.api_key FROM instagram_channels c JOIN instagram_zernio_accounts z ON z.id=c.zernio_account_id WHERE c.account_id=? AND c.session_id=?',
    params,
  );
}
export function findByIgAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM instagram_channels WHERE zernio_account_id=? AND ig_account_id=?',
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT session_id,zernio_account_id,ig_account_id,username,status FROM instagram_channels WHERE account_id=? ORDER BY created_at,session_id',
    params,
  );
}
export function listByZernio(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT session_id FROM instagram_channels WHERE zernio_account_id=? AND account_id=?',
    params,
  );
}
export function updateConnection(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE instagram_channels SET username=?,status=? WHERE zernio_account_id=? AND ig_account_id=?',
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE instagram_channels SET status=? WHERE zernio_account_id=? AND ig_account_id=?', params);
}
export function deleteBySession(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM instagram_channels WHERE account_id=? AND session_id=?', params);
}
