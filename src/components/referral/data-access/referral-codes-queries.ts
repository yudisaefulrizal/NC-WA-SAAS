// Query tabel referral_codes untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralCodesSql.findByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=?', params);
}
export function lockByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT code FROM referral_codes WHERE account_id=? FOR UPDATE', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO referral_codes(account_id,code) VALUES (?,?)', params);
}
export function lockOwnerByCode(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT account_id FROM referral_codes WHERE code=? FOR UPDATE', params);
}
