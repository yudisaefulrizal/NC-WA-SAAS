// Query tabel ai_conversations untuk komponen ai. Dipanggil lewat namespace, misalnya
// `conversationsSql.lockMessages(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function lockMessages(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT messages FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',
    params,
  );
}
export function updateMessagesAndRevision(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_conversations SET messages=?,revision=revision+1 WHERE account_id=? AND session_id=? AND customer=?',
    params,
  );
}
export function lockForReply(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT messages,paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',
    params,
  );
}
export function pauseForManualReply(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_conversations SET paused=IF(full_auto,FALSE,TRUE),revision=revision+1,router_context=NULL,messages=? WHERE account_id=? AND session_id=? AND customer=?',
    params,
  );
}
export function deleteBySession(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_conversations WHERE account_id=? AND session_id=?', params);
}
export function listAllBySession(c: Executor, params: SqlValue[]) {
  return c.execute(
    'SELECT customer,paused,full_auto,JSON_LENGTH(messages) AS message_count,router_context FROM ai_conversations WHERE account_id=? AND session_id=? ORDER BY customer LIMIT 200',
    params,
  );
}
export function lockControls(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',
    params,
  );
}
export function upsertControls(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO ai_conversations(account_id,session_id,customer,paused,full_auto,messages) VALUES (?,?,?,?,?,'[]') ON DUPLICATE KEY UPDATE paused=VALUES(paused),full_auto=IF(?,VALUES(full_auto),full_auto),router_context=IF(?,NULL,router_context),messages=IF(?,JSON_ARRAY(),messages),revision=revision+1",
    params,
  );
}
export function findControls(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT paused,full_auto FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    params,
  );
}
export function updateMessages(c: Executor, params: SqlValue[]) {
  return c.execute('UPDATE ai_conversations SET messages=? WHERE account_id=? AND session_id=? AND customer=?', params);
}
export function ensure(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT IGNORE INTO ai_conversations(account_id,session_id,customer,paused,messages) VALUES (?,?,?,FALSE,'[]')",
    params,
  );
}
export function lockForMessage(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT paused,messages,revision,router_context FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',
    params,
  );
}
export function findPausedRevision(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT paused,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=?',
    params,
  );
}
export function lockMessagesRevision(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT messages,revision FROM ai_conversations WHERE account_id=? AND session_id=? AND customer=? FOR UPDATE',
    params,
  );
}
export function updateMessagesAndContext(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_conversations SET messages=?,router_context=? WHERE account_id=? AND session_id=? AND customer=?',
    params,
  );
}
export function lockCustomersOfSession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT customer FROM ai_conversations WHERE account_id=? AND session_id=? FOR UPDATE',
    params,
  );
}
export function clearMemoryOfSession(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_conversations SET messages=JSON_ARRAY(),router_context=NULL,revision=revision+1 WHERE account_id=? AND session_id=?',
    params,
  );
}
export function listFirst200BySession(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT customer,paused,full_auto,JSON_LENGTH(messages) AS message_count,router_context FROM ai_conversations WHERE account_id=? AND session_id=?',
    params,
  );
}
export function lockAll(c: Executor) {
  return c.query<RowDataPacket[]>('SELECT account_id,session_id,customer,messages FROM ai_conversations FOR UPDATE');
}
