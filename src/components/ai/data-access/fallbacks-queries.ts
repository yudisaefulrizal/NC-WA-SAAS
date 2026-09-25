// Query tabel ai_fallbacks untuk komponen ai. Dipanggil lewat namespace, misalnya
// `fallbacksSql.lockWaitingByNotification(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockWaitingByNotification(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    `SELECT * FROM ai_fallbacks WHERE account_id=? AND session_id=? AND status='waiting' AND (notification_message_id=? OR id=?) FOR UPDATE`,
    params,
  );
}
export function markAnswered(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE ai_fallbacks SET status='answered',staff_answer=?,answered_at=UTC_TIMESTAMP() WHERE id=?",
    params,
  );
}
export function updateResolution(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_fallbacks SET status=?,resolved_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=?', params);
}
export function lockWaiting(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT * FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=? AND status='waiting' FOR UPDATE",
    params,
  );
}
export function countBySession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM ai_fallbacks WHERE account_id=? AND session_id=?',
    params,
  );
}
export function listPage(c: Executor, params: SqlValue[], size: number, page: number) {
  return c.execute(
    'SELECT id,customer,status,agent,reason,question,staff_answer,created_at,answered_at,resolved_at FROM ai_fallbacks WHERE account_id=? AND session_id=? ORDER BY created_at DESC,id DESC LIMIT ' +
      size +
      ' OFFSET ' +
      (page - 1) * size,
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute<ResultSetHeader>('DELETE FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=?', params);
}
export function lockStatus(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT status FROM ai_fallbacks WHERE id=? AND account_id=? AND session_id=? FOR UPDATE',
    params,
  );
}
export function findWaitingForCustomer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT id,question FROM ai_fallbacks WHERE account_id=? AND session_id=? AND customer=? AND status='waiting' ORDER BY created_at DESC LIMIT 5",
    params,
  );
}
export function insertIgnore(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT IGNORE INTO ai_fallbacks(id,account_id,session_id,customer,fallback_number,agent,reason,question,router_context,messages,source_message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    params,
  );
}
export function setConfirmationMessage(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_fallbacks SET confirmation_message_id=? WHERE id=?', params);
}
export function setNotificationMessage(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_fallbacks SET notification_message_id=? WHERE id=?', params);
}
export function markFailed(c: Executor, params: SqlValue[]) {
  return c.execute("UPDATE ai_fallbacks SET status='failed' WHERE id=?", params);
}
