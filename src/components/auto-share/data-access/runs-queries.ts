// Query tabel auto_share_runs untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `runsSql.findActiveForJob(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findActiveForJob(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id FROM auto_share_runs WHERE account_id=? AND job_id=? AND status IN ('queued','running') LIMIT 1",
    params,
  );
}
export function listActive(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id FROM auto_share_runs WHERE account_id=? AND status IN ('queued','running') LIMIT 32",
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,media_type,asset_id,filename,source_data,tidied,tidy_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
export function listHistory(c: Executor, params: SqlValue[]) {
  return c.execute(
    `SELECT r.*,COUNT(d.id) AS total,SUM(d.status='sent') AS sent,SUM(d.status='failed') AS failed,SUM(d.status='unknown') AS unknown_count FROM auto_share_runs r LEFT JOIN auto_share_deliveries d ON d.run_id=r.id WHERE r.account_id=? GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`,
    params,
  );
}
export function insertFailedSchedule(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO auto_share_runs(id,account_id,job_id,job_name,template_id,template_name,session_id,message,source,status,finished_at) VALUES (?,?,?,?,?,?,?,?,'schedule','failed',UTC_TIMESTAMP(3))",
    params,
  );
}
export function markRunning(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE auto_share_runs SET status='running' WHERE id=?", params);
}
export function markQueued(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE auto_share_runs SET status='queued' WHERE id=?", params);
}
export function finish(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE auto_share_runs SET status=IF(EXISTS(SELECT 1 FROM auto_share_deliveries WHERE run_id=? AND status<>'sent'),'completed_with_errors','completed'),finished_at=UTC_TIMESTAMP(3) WHERE id=?",
    params,
  );
}
export function findNextQueued(c: Executor) {
  return c.query<RowDataPacket[]>("SELECT * FROM auto_share_runs WHERE status='queued' ORDER BY created_at LIMIT 1");
}
export function requeueRunning(c: Executor) {
  return c.query("UPDATE auto_share_runs SET status='queued' WHERE status='running'");
}
