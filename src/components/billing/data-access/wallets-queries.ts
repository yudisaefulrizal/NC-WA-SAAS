// Query tabel wallets untuk komponen billing. Dipanggil lewat namespace, misalnya
// `walletsSql.addBalance(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function addBalance(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE wallets SET balance=balance+? WHERE account_id=?', params);
}
export function lock(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM wallets WHERE account_id=? FOR UPDATE', params);
}
export function resetToBasic(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO wallets (account_id,period,balance,quota,session_limit,plan_id,expires_at) VALUES (?,?,?,?,?,'basic',NULL) ON DUPLICATE KEY UPDATE period=VALUES(period),balance=VALUES(balance),quota=VALUES(quota),session_limit=VALUES(session_limit),plan_id='basic',expires_at=NULL",
    params,
  );
}
export function find(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT period,balance,quota,session_limit,plan_id,expires_at FROM wallets WHERE account_id=?',
    params,
  );
}
export function renew(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE wallets SET period=?,balance=balance+?,quota=?,session_limit=?,plan_id=?,expires_at=? WHERE account_id=?',
    params,
  );
}
export function debitOne(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE wallets SET balance=balance-1 WHERE account_id=?', params);
}
export function refundOne(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE wallets SET balance=balance+1 WHERE account_id=?', params);
}
