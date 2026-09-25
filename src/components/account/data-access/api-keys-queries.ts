// Query tabel api_keys untuk komponen account. Dipanggil lewat namespace, misalnya
// `apiKeysSql.findAccountIdByHash(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findAccountIdByHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT k.account_id AS id FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',
    params,
  );
}
export function findAccountByHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT a.id,a.email FROM api_keys k JOIN accounts a ON a.id=k.account_id WHERE k.key_hash=? AND a.suspended=FALSE',
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute('SELECT id,created_at FROM api_keys WHERE account_id=?', params);
}
export function findHash(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT key_hash FROM api_keys WHERE id=? AND account_id=?', params);
}
export function deleteByIdAndAccount(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM api_keys WHERE id=? AND account_id=?', params);
}
export function listHashesByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id,key_hash FROM api_keys WHERE account_id=?', params);
}
export function deleteByAccountAndId(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM api_keys WHERE account_id=? AND id=?', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO api_keys(id,account_id,key_hash) VALUES (?,?,?)', params);
}
