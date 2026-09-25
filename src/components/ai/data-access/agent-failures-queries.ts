// Query tabel ai_agent_failures untuk komponen ai. Dipanggil lewat namespace, misalnya
// `agentFailuresSql.count(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function count(c: Executor) {
  return c.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ai_agent_failures');
}
export function listPage(c: Executor, size: number, page: number) {
  return c.query(
    'SELECT id,account_id,session_id,request_id,agent,error,message,model,created_at FROM ai_agent_failures ORDER BY created_at DESC,id DESC LIMIT ' +
      size +
      ' OFFSET ' +
      (page - 1) * size,
  );
}
export function findDetail(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT prompt,raw_output,router_context FROM ai_agent_failures WHERE id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_agent_failures(account_id,session_id,request_id,agent,error,message,model,prompt,raw_output,router_context) VALUES (?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
