// Query tabel ai_usage untuk komponen ai. Dipanggil lewat namespace, misalnya
// `usageSql.listRecentByAccount(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function listRecentByAccount(c: Executor, params: SqlValue[]) {
  return c.execute(
    'SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC LIMIT 100',
    params,
  );
}
export function countByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_usage WHERE account_id=?', params);
}
export function listPageByAccount(c: Executor, params: SqlValue[], size: number, page: number) {
  return c.execute(
    'SELECT request_id,session_id,customer,status,input_words,output_words,input_rate,output_rate,charged,reserved,agent,created_at FROM ai_usage WHERE account_id=? ORDER BY created_at DESC,request_id DESC LIMIT ' +
      size +
      ' OFFSET ' +
      (page - 1) * size,
    params,
  );
}
export function listLatest(c: Executor) {
  return c.query(
    'SELECT account_id,session_id,request_id,status,agent,model_calls,created_at FROM ai_usage ORDER BY created_at DESC LIMIT 100',
  );
}
export function lockGenerating(c: Executor, params: SqlValue[], account: string | undefined) {
  return c.execute<RowDataPacket[]>(
    "SELECT account_id,request_id,reserved FROM ai_usage WHERE status='generating'" +
      (account ? ' AND account_id=?' : '') +
      ' FOR UPDATE',
    params,
  );
}
export function markInterrupted(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE ai_usage SET status='interrupted',reserved=0 WHERE account_id=? AND request_id=?", params);
}
export function resolveGenerated(c: Executor, params: SqlValue[], account: string | undefined) {
  return c.execute(
    "UPDATE ai_usage u LEFT JOIN credit_reservations r ON r.account_id=u.account_id AND r.request_id=CONCAT('ai_',u.request_id) SET u.status=CONCAT(IF(u.status='fallback_generated','fallback_',''),IF(r.status='sent','sent','send_unknown')) WHERE u.status IN ('generated','fallback_generated')" +
      (account ? ' AND u.account_id=?' : ''),
    params,
  );
}
export function findRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT request_id FROM ai_usage WHERE account_id=? AND request_id=?', params);
}
export function insertMessage(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,profile_type,data_profile_id) VALUES (?,?,?,?,'generating',?,?,?,?,?,?,?)",
    params,
  );
}
export function finishMessage(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,model_calls=?,model=?,reserved=0 WHERE account_id=? AND request_id=?',
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_usage SET status=? WHERE account_id=? AND request_id=?', params);
}
export function insertTrial(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,profile_type,data_profile_id) VALUES (?,?,?,'trial','generating',?,?,?,?,?,?,?)",
    params,
  );
}
export function finishTrial(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_usage SET status=?,output_words=?,charged=?,agent=?,reserved=0 WHERE account_id=? AND request_id=?',
    params,
  );
}
