// Query tabel referral_payouts untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralPayoutsSql.sumActiveByReferrer(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function sumActiveByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid')",
    params,
  );
}
export function listByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,amount,status,note,created_at,processed_at FROM referral_payouts WHERE referrer_id=? ORDER BY created_at DESC LIMIT 200',
    params,
  );
}
export function lockActiveSum(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COALESCE(SUM(amount),0) AS total FROM referral_payouts WHERE referrer_id=? AND status IN ('requested','paid') FOR UPDATE",
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO referral_payouts(id,referrer_id,amount,bank_name,bank_account_name,bank_account_number) VALUES (?,?,?,?,?,?)',
    params,
  );
}
export function listByStatus(c: Executor, params: SqlValue[], status: string | undefined, valid: string[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.id,p.referrer_id,a.email AS referrer_email,p.amount,p.bank_name,p.bank_account_name,p.bank_account_number,p.status,p.note,p.created_at,p.processed_at FROM referral_payouts p JOIN accounts a ON a.id=p.referrer_id' +
      (status && valid.includes(status) ? ' WHERE p.status=?' : '') +
      ' ORDER BY p.created_at ASC LIMIT 300',
    params,
  );
}
export function lockStatus(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT status FROM referral_payouts WHERE id=? FOR UPDATE', params);
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE referral_payouts SET status=?,note=?,processed_at=UTC_TIMESTAMP(),processed_by=? WHERE id=?',
    params,
  );
}
