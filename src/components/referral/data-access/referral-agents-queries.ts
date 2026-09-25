// Query tabel referral_agents untuk komponen referral. Dipanggil lewat namespace, misalnya
// `referralAgentsSql.findCommission(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findCommission(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT commission_percent FROM referral_agents WHERE account_id=?', params);
}
export function deleteByAccount(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM referral_agents WHERE account_id=?', params);
}
export function upsert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO referral_agents(account_id,commission_percent,note,set_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE commission_percent=VALUES(commission_percent),note=VALUES(note),set_by=VALUES(set_by)',
    params,
  );
}
export function listAll(c: Executor) {
  return c.query<RowDataPacket[]>(
    'SELECT ag.account_id,a.email,ag.commission_percent,ag.note,ag.created_at FROM referral_agents ag JOIN accounts a ON a.id=ag.account_id ORDER BY ag.created_at DESC',
  );
}
