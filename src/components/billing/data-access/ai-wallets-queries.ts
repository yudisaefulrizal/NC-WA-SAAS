// Query tabel ai_wallets untuk komponen billing. Dipanggil lewat namespace, misalnya
// `aiWalletsSql.addBalance(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
// `balance` adalah kredit hasil beli (tidak hangus); kredit paket ada di plan_* dan hangus bersama paketnya.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function addBalance(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_wallets(account_id,balance) VALUES (?,?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)',
    params,
  );
}
// Kredit paket menggantikan sisa kredit paket sebelumnya, seperti kredit WhatsApp paket: [akun, jumlah, berlaku sampai, periode].
export function grantPlan(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_wallets(account_id,plan_balance,plan_quota,plan_expires_at,plan_period) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE plan_balance=VALUES(plan_balance),plan_quota=VALUES(plan_quota),plan_expires_at=VALUES(plan_expires_at),plan_period=VALUES(plan_period)',
    params,
  );
}
export function findPlanPeriod(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT plan_period FROM ai_wallets WHERE account_id=?', params);
}
