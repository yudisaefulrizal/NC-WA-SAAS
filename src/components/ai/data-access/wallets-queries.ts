// Query tabel ai_wallets untuk komponen ai. Dipanggil lewat namespace, misalnya
// `walletsSql.ensure(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
// Saldo punya dua wadah: `balance` (hasil beli, tidak hangus) dan `plan_balance` (dari paket, hangus di
// plan_expires_at). `balance` yang dikembalikan findBalance/lockBalance adalah jumlah keduanya; pemakaian mengambil
// kredit paket lebih dulu, dan refund dikembalikan ke wadah asalnya.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
const planActive = 'plan_expires_at>UTC_TIMESTAMP(3)';
const columns = `balance+IF(${planActive},plan_balance,0) AS balance,balance AS purchased,IF(${planActive},plan_balance,0) AS plan_balance,IF(${planActive},plan_quota,0) AS plan_quota,plan_expires_at`;
export function ensure(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT IGNORE INTO ai_wallets(account_id) VALUES (?)', params);
}
// [jumlah, akun]. Kredit paket lebih dulu, sisanya dari saldo hasil beli. Urutan SET penting: MySQL memakai nilai
// terbaru, jadi balance dihitung sebelum plan_balance berubah. Pemanggil sudah memastikan saldo total cukup.
export function debit(c: Executor, params: SqlValue[]) {
  const [amount, account] = params;
  return c.execute(
    `UPDATE ai_wallets SET balance=balance-GREATEST(0,?-IF(${planActive},plan_balance,0)),plan_balance=plan_balance-LEAST(?,IF(${planActive},plan_balance,0)) WHERE account_id=?`,
    [amount, amount, account],
  );
}
// [bagian ke saldo beli, bagian ke kredit paket, akun]. Kredit paket yang sudah hangus tidak dikembalikan, dan tidak
// pernah melewati kuota paket.
export function refund(c: Executor, params: SqlValue[]) {
  const [toBalance, toPlan, account] = params;
  return c.execute(
    `UPDATE ai_wallets SET balance=balance+?,plan_balance=plan_balance+IF(${planActive},LEAST(?,GREATEST(0,plan_quota-plan_balance)),0) WHERE account_id=?`,
    [toBalance, toPlan, account],
  );
}
// Penyesuaian pemilik dan pembelian: hanya saldo hasil beli.
export function credit(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_wallets SET balance=balance+? WHERE account_id=?', params);
}
export function findBalance(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(`SELECT ${columns} FROM ai_wallets WHERE account_id=?`, params);
}
export function lockBalance(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(`SELECT ${columns} FROM ai_wallets WHERE account_id=? FOR UPDATE`, params);
}
