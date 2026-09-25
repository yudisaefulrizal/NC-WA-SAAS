// Query tabel ai_trace_log untuk komponen ai. Dipanggil lewat namespace, misalnya
// `traceLogSql.countRequests(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function countRequests(c: Executor) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(DISTINCT request_id) AS total FROM ai_trace_log');
}
export function listRequestsPage(c: Executor, size: number, page: number) {
  return c.query(
    'SELECT request_id,account_id,session_id,MIN(created_at) AS started_at,COUNT(*) AS event_count FROM ai_trace_log GROUP BY request_id,account_id,session_id ORDER BY started_at DESC LIMIT ' +
      size +
      ' OFFSET ' +
      (page - 1) * size,
  );
}
export function listByRequest(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT node,state,model,attempt,duration_ms,input,output,error,created_at FROM ai_trace_log WHERE request_id=? ORDER BY id',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_trace_log(account_id,session_id,request_id,profile_type,node,state,model,attempt,duration_ms,input,output,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
