// Query tabel ai_adjustments untuk komponen ai. Dipanggil lewat namespace, misalnya
// `adjustmentsSql.findRequest(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT amount,reason FROM ai_adjustments WHERE account_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_adjustments(account_id,request_id,actor_id,amount,reason) VALUES (?,?,?,?,?)',
    params,
  );
}
