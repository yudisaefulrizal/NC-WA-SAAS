// Query tabel referral_earnings untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralEarningsSql.insert(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO referral_earnings(id,referrer_id,referral_id,order_id,amount) VALUES (?,?,?,?,?)',
    params,
  );
}
export function sumByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COALESCE(SUM(amount),0) AS total FROM referral_earnings WHERE referrer_id=?',
    params,
  );
}
export function listByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT e.id,e.amount,e.created_at,a.email FROM referral_earnings e JOIN referrals r ON r.id=e.referral_id JOIN accounts a ON a.id=r.referred_id WHERE e.referrer_id=? ORDER BY e.created_at DESC LIMIT 200`,
    params,
  );
}
