// Query tabel referrals untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralsSql.lockByReferred(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockByReferred(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM referrals WHERE referred_id=? FOR UPDATE', params);
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO referrals(id,referrer_id,referred_id,code) VALUES (?,?,?,?)', params);
}
export function lockPending(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='pending' FOR UPDATE",
    params,
  );
}
export function markQualified(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE referrals SET status='qualified',qualified_at=UTC_TIMESTAMP() WHERE id=?", params);
}
export function lockQualified(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id,referrer_id FROM referrals WHERE referred_id=? AND status='qualified' FOR UPDATE",
    params,
  );
}
export function countByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS total,SUM(status='qualified') AS qualified FROM referrals WHERE referrer_id=?",
    params,
  );
}
export function findByReferred(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT r.code,r.status,r.qualified_at,a.email AS referrer_email FROM referrals r JOIN accounts a ON a.id=r.referrer_id WHERE r.referred_id=?',
    params,
  );
}
export function listByReferrer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT r.id,a.email,r.status,r.created_at,r.qualified_at,COALESCE(SUM(e.amount),0) AS earnings
   FROM referrals r JOIN accounts a ON a.id=r.referred_id LEFT JOIN referral_earnings e ON e.referral_id=r.id
   WHERE r.referrer_id=? GROUP BY r.id,a.email,r.status,r.created_at,r.qualified_at ORDER BY r.created_at DESC LIMIT 200`,
    params,
  );
}
export function listAllForOwner(c: Executor) {
  return c.query<
    RowDataPacket[]
  >(`SELECT r.id,ra.email AS referrer_email,re.email AS referred_email,r.code,r.status,r.created_at,r.qualified_at,
   (SELECT phone_number FROM referral_qualified_numbers WHERE referral_id=r.id) AS qualified_number,
   COALESCE((SELECT SUM(amount) FROM referral_earnings WHERE referral_id=r.id),0) AS earnings,
   ag.commission_percent AS agent_commission_percent
   FROM referrals r JOIN accounts ra ON ra.id=r.referrer_id JOIN accounts re ON re.id=r.referred_id
   LEFT JOIN referral_agents ag ON ag.account_id=r.referrer_id
   ORDER BY r.created_at DESC LIMIT 300`);
}
