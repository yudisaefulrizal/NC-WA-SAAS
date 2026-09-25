// Query tabel ai_usage untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `aiUsageSql.insert(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_usage(account_id,request_id,session_id,customer,status,input_words,input_rate,output_rate,reserved,model,agent) VALUES (?,?,'auto-share','share','generating',?,?,?,?,?,'rapikan')",
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_usage SET status=?,output_words=?,charged=? WHERE account_id=? AND request_id=?', params);
}
