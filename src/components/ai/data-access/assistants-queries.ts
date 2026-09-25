// Query tabel ai_assistants untuk komponen ai. Dipanggil lewat namespace, misalnya
// `assistantsSql.findFallbackNumber(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function findFallbackNumber(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT p.fallback_number FROM ai_assistants a JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=? AND a.session_id=? AND p.fallback_number=? AND p.fallback_notify=TRUE',
    params,
  );
}
export function findEnabled(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT enabled FROM ai_assistants WHERE account_id=? AND session_id=?', params);
}
export function deleteBySession(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM ai_assistants WHERE account_id=? AND session_id=?', params);
}
export function findForRuntime(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT a.enabled,p.*,p.id AS data_profile_id FROM ai_assistants a JOIN ai_data_profiles p ON p.id=a.data_profile_id AND p.account_id=a.account_id JOIN ai_profile_types t ON t.id=p.profile_type AND t.enabled=TRUE WHERE a.account_id=? AND a.session_id=? AND p.profile_type=?',
    params,
  );
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT a.session_id,a.enabled,p.id,p.name,p.profile_type FROM ai_assistants a LEFT JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=?',
    params,
  );
}
export function upsertEnabled(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_assistants(account_id,session_id,enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),revision=revision+1',
    params,
  );
}
export function lockDataProfileId(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT data_profile_id FROM ai_assistants WHERE account_id=? AND session_id=? FOR UPDATE',
    params,
  );
}
export function attachNew(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_assistants(account_id,session_id,enabled,data_profile_id) VALUES (?,?,FALSE,?) ON DUPLICATE KEY UPDATE data_profile_id=VALUES(data_profile_id),revision=revision+1',
    params,
  );
}
export function findDataProfileId(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT data_profile_id FROM ai_assistants WHERE account_id=? AND session_id=?',
    params,
  );
}
export function listAttachments(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT data_profile_id,session_id FROM ai_assistants WHERE account_id=? AND data_profile_id IS NOT NULL ORDER BY session_id',
    params,
  );
}
export function listSessionsOfProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT session_id FROM ai_assistants WHERE account_id=? AND data_profile_id=? ORDER BY session_id',
    params,
  );
}
export function lockSessionsOfProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT session_id FROM ai_assistants WHERE account_id=? AND data_profile_id=? FOR UPDATE',
    params,
  );
}
export function lockAttachment(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT data_profile_id,enabled FROM ai_assistants WHERE account_id=? AND session_id=? FOR UPDATE',
    params,
  );
}
export function upsertAttachment(c: Executor, params: SqlValue[]) {
  return c.execute(
    'INSERT INTO ai_assistants(account_id,session_id,enabled,data_profile_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),data_profile_id=VALUES(data_profile_id),revision=revision+1',
    params,
  );
}
export function findWithProfile(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT a.enabled,a.data_profile_id,p.* FROM ai_assistants a LEFT JOIN ai_data_profiles p ON p.id=a.data_profile_id WHERE a.account_id=? AND a.session_id=?',
    params,
  );
}
export function updateEnabled(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE ai_assistants SET enabled=?,revision=revision+1 WHERE account_id=? AND session_id=?',
    params,
  );
}
