// Query tabel ai_wallets untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `aiWalletsSql.ensure(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function ensure(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT IGNORE INTO ai_wallets VALUES (?,0)', params);
}
export function lockBalance(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=? FOR UPDATE', params);
}
export function debit(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_wallets SET balance=balance-? WHERE account_id=?', params);
}
export function credit(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?', params);
}
