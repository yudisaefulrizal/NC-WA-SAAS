// Query tabel auto_share_deliveries untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `deliveriesSql.insert(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute('INSERT INTO auto_share_deliveries(id,run_id,nomor,position) VALUES (?,?,?,?)', params);
}
export function listForRun(c: Executor, params: SqlValue[]) {
  return c.execute(
    'SELECT d.* FROM auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id WHERE r.account_id=? AND r.id=? ORDER BY d.position',
    params,
  );
}
export function insertFailed(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO auto_share_deliveries(id,run_id,nomor,position,status,error) VALUES (?,?,?,0,'failed',?)",
    params,
  );
}
export function listPending(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT * FROM auto_share_deliveries WHERE run_id=? AND status='pending' ORDER BY position",
    params,
  );
}
export function markSending(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE auto_share_deliveries SET status='sending' WHERE id=?", params);
}
export function markSent(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE auto_share_deliveries SET status='sent',message_id=? WHERE id=?", params);
}
export function updateResult(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE auto_share_deliveries SET status=?,error=? WHERE id=?', params);
}
export function findUnfinished(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id FROM auto_share_deliveries WHERE run_id=? AND status IN ('pending','sending') LIMIT 1",
    params,
  );
}
export function resolveInterrupted(c: Executor) {
  return c.query(
    "UPDATE auto_share_deliveries d JOIN auto_share_runs r ON r.id=d.run_id LEFT JOIN outbound_results o ON o.account_id=r.account_id AND o.request_id=CONCAT('share_',d.id) SET d.status=IF(o.message_id IS NULL,'unknown','sent'),d.message_id=o.message_id,d.error=IF(o.message_id IS NULL,'Proses terhenti; hasil belum pasti dan tidak dikirim ulang.',NULL) WHERE d.status='sending'",
  );
}
