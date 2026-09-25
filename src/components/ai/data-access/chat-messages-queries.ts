// Query tabel ai_chat_messages untuk komponen ai. Dipanggil lewat namespace, misalnya
// `chatMessagesSql.findManualOrigin(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findManualOrigin(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT origin FROM ai_chat_messages WHERE account_id=? AND session_id=? AND message_id=? AND origin='manual'",
    params,
  );
}
export function insertIgnore(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT IGNORE INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,type,text) VALUES (?,?,?,?,'in','customer',?,?)",
    params,
  );
}
export function findCustomerOfOutgoing(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT customer FROM ai_chat_messages WHERE account_id=? AND session_id=? AND message_id=? AND direction='out' AND (status IS NULL OR FIELD(status,'sent','delivered','read')<FIELD(?,'sent','delivered','read'))",
    params,
  );
}
export function updateStatus(c: Executor, params: SqlValue[]) {
  return c.execute(
    "UPDATE ai_chat_messages SET status=? WHERE account_id=? AND session_id=? AND message_id=? AND (status IS NULL OR FIELD(status,'sent','delivered','read')<FIELD(?,'sent','delivered','read'))",
    params,
  );
}
export function listLatestPerCustomer(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    "SELECT customer,text,direction,origin,type,created_at FROM (SELECT customer,text,direction,origin,type,created_at,ROW_NUMBER() OVER (PARTITION BY customer ORDER BY created_at DESC,message_id DESC) AS n FROM ai_chat_messages WHERE account_id=? AND session_id=? AND direction<>'note') t WHERE n=1",
    params,
  );
}
export function listPage(c: Executor, params: SqlValue[], cursor: [Date, string] | undefined) {
  return c.execute<RowDataPacket[]>(
    'SELECT message_id,direction,origin,type,text,status,created_at FROM ai_chat_messages WHERE account_id=? AND session_id=? AND customer=?' +
      (cursor ? ' AND (created_at<? OR (created_at=? AND message_id<?))' : '') +
      ' ORDER BY created_at DESC,message_id DESC LIMIT 101',
    params,
  );
}
export function upsertOutgoing(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,type,text,status) VALUES (?,?,?,?,'out',?,?,?,'sent') ON DUPLICATE KEY UPDATE origin=IF(VALUES(origin)='api',origin,VALUES(origin))",
    params,
  );
}
export function insertNote(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_chat_messages(account_id,session_id,customer,message_id,direction,origin,text) VALUES (?,?,?,?,'note','system',?)",
    params,
  );
}
