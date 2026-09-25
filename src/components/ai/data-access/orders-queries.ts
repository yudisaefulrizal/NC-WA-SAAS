// Query tabel ai_orders untuk komponen ai. Dipanggil lewat namespace, misalnya
// `ordersSql.listByProfile(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listByProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_orders WHERE account_id=? AND data_profile_id=? ORDER BY created_at DESC,id DESC LIMIT 200',
    params,
  );
}
export function findForCustomer(c: Executor, params: SqlValue[], customer: string | undefined) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_orders WHERE account_id=? AND data_profile_id=? AND id=?' + (customer ? ' AND customer=?' : ''),
    params,
  );
}
export function lockOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id FROM ai_orders WHERE account_id=? AND data_profile_id=? AND id=? FOR UPDATE',
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_orders SET status=?,notes=? WHERE account_id=? AND data_profile_id=? AND id=?', params);
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM ai_orders WHERE account_id=? AND data_profile_id=? AND id=?', params);
}
export function findByRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT * FROM ai_orders WHERE account_id=? AND data_profile_id=? AND request_id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_orders(account_id,data_profile_id,session_id,id,request_id,input_hash,customer,items,total,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
