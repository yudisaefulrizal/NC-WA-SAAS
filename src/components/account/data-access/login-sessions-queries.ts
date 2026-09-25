// Query tabel login_sessions untuk komponen account. Dipanggil lewat namespace, misalnya
// `loginSessionsSql.findAccountIdByToken(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findAccountIdByToken(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT s.account_id AS id FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))', params);
}
export function findAccountByToken(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT a.id,a.email,a.role FROM login_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.suspended=FALSE',
    params,
  );
}
export function deleteByToken(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM login_sessions WHERE token_hash=?', params);
}
export function deleteOthers(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM login_sessions WHERE account_id=? AND token_hash<>?', params);
}
export function deleteByAccount(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM login_sessions WHERE account_id=?', params);
}
export function findValid(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT account_id FROM login_sessions WHERE token_hash=? AND account_id=? AND expires_at>UTC_TIMESTAMP()',
    params,
  );
}
