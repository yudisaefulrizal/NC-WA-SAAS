// Query tabel referral_profiles untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralProfilesSql.findByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=?',
    params,
  );
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO referral_profiles(account_id,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE bank_name=VALUES(bank_name),bank_account_name=VALUES(bank_account_name),bank_account_number=VALUES(bank_account_number)',
    params,
  );
}
export function lockByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT bank_name,bank_account_name,bank_account_number FROM referral_profiles WHERE account_id=? FOR UPDATE',
    params,
  );
}
