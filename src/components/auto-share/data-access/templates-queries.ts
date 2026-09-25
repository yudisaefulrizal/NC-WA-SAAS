// Query tabel auto_share_templates untuk komponen auto-share. Dipanggil lewat namespace, misalnya
// `templatesSql.shareOwned(db, [...])`; argumen pertama adalah pool atau koneksi transaksi.
import type { RowDataPacket } from 'mysql2/promise';
import type { Executor, SqlValue } from '../../../libraries/db.js';
export function shareOwned(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT * FROM auto_share_templates WHERE account_id=? AND id=? FOR SHARE', params);
}
export function findForSend(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,message,media_type,media_source,media_variable,source_mode,source_endpoint,source_secret,tidy,tidy_note FROM auto_share_templates WHERE account_id=? AND id=?',
    params,
  );
}
export function listUsingAsset(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM auto_share_templates WHERE account_id=? AND asset_id=?', params);
}
export function listByAccount(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT id,name,message,media_type,asset_id,filename,source_mode,source_endpoint,media_source,media_variable,tidy,tidy_note,source_secret FROM auto_share_templates WHERE account_id=? ORDER BY created_at DESC',
    params,
  );
}
export function lockSource(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT source_endpoint,source_secret FROM auto_share_templates WHERE account_id=? AND id=? FOR UPDATE',
    params,
  );
}
export function update(c: Executor, params: SqlValue[]) {
  return c.execute(
    'UPDATE auto_share_templates SET name=?,message=?,media_type=?,asset_id=?,filename=?,source_mode=?,source_endpoint=?,source_secret=?,media_source=?,media_variable=?,tidy=?,tidy_note=? WHERE account_id=? AND id=?',
    params,
  );
}
export function insert(c: Executor, params: SqlValue[]) {
  return c.execute(
    "INSERT INTO auto_share_templates(id,account_id,name,message,media_type,asset_id,filename,source_mode,source_endpoint,source_secret,media_source,media_variable,tidy,tidy_note,session_id,contacts,groups_json,content_migrated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'',JSON_ARRAY(),JSON_ARRAY(),TRUE)",
    params,
  );
}
export function findSource(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>(
    'SELECT source_endpoint,source_secret FROM auto_share_templates WHERE account_id=? AND id=?',
    params,
  );
}
export function deleteOwned(c: Executor, params: SqlValue[]) {
  return c.execute('DELETE FROM auto_share_templates WHERE account_id=? AND id=?', params);
}
export function listIds(c: Executor, params: SqlValue[]) {
  return c.execute<RowDataPacket[]>('SELECT id FROM auto_share_templates WHERE account_id=?', params);
}
