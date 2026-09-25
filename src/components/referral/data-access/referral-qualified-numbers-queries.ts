// Query tabel referral_qualified_numbers untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralQualifiedNumbersSql.insertIgnore(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insertIgnore(c: Executor, params: SqlValue[]) {
  return c.execute<import('mysql2/promise').ResultSetHeader>(
    'INSERT IGNORE INTO referral_qualified_numbers(phone_number,referral_id) VALUES (?,?)',
    params,
  );
}
